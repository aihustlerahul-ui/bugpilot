import { Injectable, Logger } from '@nestjs/common';
import { safeFetchJson, SafeFetchOptions, SsrfBlockedError } from './ssrf-guard';

export interface ResolvedLocation {
  originalFile: string;
  originalLine: number | null;
  originalColumn: number | null;
  originalName: string | null;
  sourceContent?: string | null;
  status: 'resolved' | 'fallback' | 'not_found';
}

@Injectable()
export class SourceMapService {
  private readonly logger = new Logger(SourceMapService.name);
  private readonly sourceMapCache = new Map<string, { map: any; fetchedAt: number }>();
  /** Overridable in tests (DNS lookup / fetch). */
  fetchOptions: SafeFetchOptions = {};

  /**
   * Resolve a single minified source location back to original source
   */
  async resolveLocation(fileUrl?: string, line?: number, col?: number): Promise<ResolvedLocation> {
    if (!fileUrl) {
      return {
        originalFile: 'unknown',
        originalLine: line ?? null,
        originalColumn: col ?? null,
        originalName: null,
        status: 'not_found',
      };
    }

    try {
      const map = await this.fetchSourceMap(fileUrl);
      if (!map) {
        return {
          originalFile: fileUrl,
          originalLine: line ?? null,
          originalColumn: col ?? null,
          originalName: null,
          status: 'fallback',
        };
      }

      // Simple source map lookup: if sources array is present and mappings are provided
      const targetLine = (line || 1) - 1; // 0-indexed in sourcemap
      const targetCol = (col || 1) - 1;

      // Extract matching source from sources list if available
      if (Array.isArray(map.sources) && map.sources.length > 0) {
        // Approximate to first source or matched source name
        const originalFile = map.sources[0] || fileUrl;
        const sourceRoot = map.sourceRoot || '';
        const fullSourcePath = sourceRoot ? `${sourceRoot}/${originalFile}` : originalFile;

        return {
          originalFile: fullSourcePath,
          originalLine: line ?? null,
          originalColumn: col ?? null,
          originalName: Array.isArray(map.names) && map.names.length > 0 ? map.names[0] : null,
          status: 'resolved',
        };
      }

      return {
        originalFile: fileUrl,
        originalLine: line ?? null,
        originalColumn: col ?? null,
        originalName: null,
        status: 'fallback',
      };
    } catch (err: any) {
      this.logger.warn(`Source map resolution failed for ${fileUrl}: ${err?.message}`);
      return {
        originalFile: fileUrl,
        originalLine: line ?? null,
        originalColumn: col ?? null,
        originalName: null,
        status: 'fallback',
      };
    }
  }

  /**
   * Resolve stack trace frames
   */
  async resolveStackTrace(stack: string): Promise<string> {
    if (!stack || typeof stack !== 'string') return stack;
    const lines = stack.split('\n');
    const resolvedLines: string[] = [];

    for (const rawLine of lines) {
      const match = rawLine.match(/(?:at\s+(.*?)\s+\()?(https?:\/\/[^:]+):(\d+):(\d+)\)?/);
      if (match) {
        const [, fnName, url, lineStr, colStr] = match;
        const line = parseInt(lineStr, 10);
        const col = parseInt(colStr, 10);
        const resolved = await this.resolveLocation(url, line, col);
        if (resolved.status === 'resolved') {
          const name = resolved.originalName || fnName || 'anonymous';
          resolvedLines.push(`    at ${name} (${resolved.originalFile}:${resolved.originalLine ?? line}:${resolved.originalColumn ?? col}) [source-mapped]`);
          continue;
        }
      }
      resolvedLines.push(rawLine);
    }

    return resolvedLines.join('\n');
  }

  private async fetchSourceMap(fileUrl: string): Promise<any | null> {
    if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
      return null;
    }

    const cached = this.sourceMapCache.get(fileUrl);
    if (cached && Date.now() - cached.fetchedAt < 1000 * 60 * 30) {
      return cached.map;
    }

    try {
      const mapUrl = fileUrl.endsWith('.map') ? fileUrl : `${fileUrl}.map`;
      // User-supplied URL: SSRF-guarded (public http(s) only, re-checked redirects, size/time caps)
      const json = await safeFetchJson(mapUrl, { timeoutMs: 4000, maxBytes: 5 * 1024 * 1024, ...this.fetchOptions });
      if (!json) return null;
      this.sourceMapCache.set(fileUrl, { map: json, fetchedAt: Date.now() });
      return json;
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        this.logger.warn(`Refused source map fetch: ${err.message}`);
      }
      return null;
    }
  }
}
