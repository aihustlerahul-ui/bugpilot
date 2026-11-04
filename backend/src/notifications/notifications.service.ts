import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;
const COMMENT_PREVIEW_CHARS = 500;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Subjects are single-line; strip CR/LF so user text can never inject headers. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

interface IssueContext {
  id: string;
  projectId: string;
  title: string;
  recipients: string[];
}

/**
 * Email notifications through Resend. Every public method is best-effort: it never
 * throws, so a mail problem can never fail the action that triggered it. Recipients
 * come only from our own database (reporter, assignee, member being added), never
 * from request input.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private warnedDisabled = false;

  constructor(private readonly supabase: SupabaseService) {}

  private get platformUrl(): string {
    return (process.env.PLATFORM_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  }

  private actorName(user: AuthUser): string {
    return (user.email ?? '').split('@')[0] || 'Someone';
  }

  private layout(heading: string, bodyHtml: string, ctaUrl: string, ctaLabel: string): string {
    return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1124">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(heading)}</h2>
  <div style="font-size:14px;line-height:1.5;color:#4b5066">${bodyHtml}</div>
  <p style="margin:20px 0 0"><a href="${escapeHtml(ctaUrl)}" style="background:#5b5fc7;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">${escapeHtml(ctaLabel)}</a></p>
  <p style="font-size:12px;color:#9097b3;margin-top:24px">Sent by BugPilot</p>
</div>`;
  }

  /** One message per recipient so addresses are never exposed to each other. */
  async send(to: string[], subject: string, html: string, text: string): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    if (!key || !from) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true;
        this.logger.warn('Email notifications are off: set RESEND_API_KEY and RESEND_FROM');
      }
      return;
    }
    const unique = [...new Set(to.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)))];
    for (const recipient of unique) {
      try {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [recipient], subject: oneLine(subject), html, text }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!res.ok) this.logger.warn(`Email send failed with status ${res.status}`);
      } catch (e) {
        this.logger.warn(`Email send failed: ${(e as Error).message}`);
      }
    }
  }

  /** Reporter + assignee of an issue, minus the person who did the action. */
  private async issueContext(issueId: string, actor: AuthUser): Promise<IssueContext | null> {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, project_id, title, description, reporter_id, assignee_member_id')
      .eq('id', issueId)
      .maybeSingle();
    if (!issue) return null;

    const emails: string[] = [];
    if (issue.reporter_id) {
      const { data } = await this.supabase.db.auth.admin.getUserById(issue.reporter_id);
      if (data?.user?.email) emails.push(data.user.email);
    }
    if (issue.assignee_member_id) {
      const { data } = await this.supabase.db
        .from('workspace_members')
        .select('email')
        .eq('id', issue.assignee_member_id)
        .maybeSingle();
      if (data?.email) emails.push(data.email);
    }
    const me = (actor.email ?? '').toLowerCase();
    const recipients = [...new Set(emails.map((e) => e.toLowerCase()))].filter((e) => e !== me);
    return {
      id: issue.id,
      projectId: issue.project_id,
      title: issue.title || issue.description || 'Untitled issue',
      recipients,
    };
  }

  private issueUrl(ctx: { id: string; projectId: string }): string {
    return `${this.platformUrl}/projects/${ctx.projectId}/issues/${ctx.id}`;
  }

  async notifyAddedToProject(actorUserId: string, email: string, projectName: string, projectId: string): Promise<void> {
    try {
      const { data } = await this.supabase.db.auth.admin.getUserById(actorUserId);
      const actor: AuthUser = { id: actorUserId, email: data?.user?.email ?? '' };
      if (actor.email.toLowerCase() === email.toLowerCase()) return;
      const url = `${this.platformUrl}/projects/${projectId}`;
      const who = this.actorName(actor);
      await this.send(
        [email],
        `You were added to ${projectName}`,
        this.layout(
          `You were added to ${projectName}`,
          `<p>${escapeHtml(who)} added you to the project <b>${escapeHtml(projectName)}</b>. You can now view and work on its bugs.</p><p>If you don't have an account yet, sign up with this email address.</p>`,
          url,
          'Open project',
        ),
        `${who} added you to the project ${projectName}. Open it: ${url}\nIf you don't have an account yet, sign up with this email address.`,
      );
    } catch (e) {
      this.logger.warn(`notifyAddedToProject failed: ${(e as Error).message}`);
    }
  }

  async notifyAssigned(actor: AuthUser, issueId: string, assigneeEmail: string): Promise<void> {
    try {
      if ((actor.email ?? '').toLowerCase() === assigneeEmail.toLowerCase()) return;
      const ctx = await this.issueContext(issueId, actor);
      if (!ctx) return;
      const url = this.issueUrl(ctx);
      const who = this.actorName(actor);
      await this.send(
        [assigneeEmail],
        `Assigned to you: ${ctx.title}`,
        this.layout(
          'A bug was assigned to you',
          `<p>${escapeHtml(who)} assigned you:</p><p><b>${escapeHtml(ctx.title)}</b></p>`,
          url,
          'View bug',
        ),
        `${who} assigned you: ${ctx.title}\n${url}`,
      );
    } catch (e) {
      this.logger.warn(`notifyAssigned failed: ${(e as Error).message}`);
    }
  }

  async notifyStatusChanged(actor: AuthUser, issueId: string, from: string | null, to: string): Promise<void> {
    try {
      if (from === to) return;
      const ctx = await this.issueContext(issueId, actor);
      if (!ctx || ctx.recipients.length === 0) return;
      const url = this.issueUrl(ctx);
      const who = this.actorName(actor);
      await this.send(
        ctx.recipients,
        `Status changed to ${to}: ${ctx.title}`,
        this.layout(
          `Status changed to ${to}`,
          `<p>${escapeHtml(who)} changed the status from <b>${escapeHtml(from ?? '—')}</b> to <b>${escapeHtml(to)}</b>:</p><p><b>${escapeHtml(ctx.title)}</b></p>`,
          url,
          'View bug',
        ),
        `${who} changed the status from ${from ?? '—'} to ${to}: ${ctx.title}\n${url}`,
      );
    } catch (e) {
      this.logger.warn(`notifyStatusChanged failed: ${(e as Error).message}`);
    }
  }

  async notifyComment(actor: AuthUser, issueId: string, body: string): Promise<void> {
    try {
      const ctx = await this.issueContext(issueId, actor);
      if (!ctx || ctx.recipients.length === 0) return;
      const url = this.issueUrl(ctx);
      const who = this.actorName(actor);
      const preview = body.length > COMMENT_PREVIEW_CHARS ? `${body.slice(0, COMMENT_PREVIEW_CHARS)}…` : body;
      await this.send(
        ctx.recipients,
        `New comment on: ${ctx.title}`,
        this.layout(
          'New comment',
          `<p>${escapeHtml(who)} commented on <b>${escapeHtml(ctx.title)}</b>:</p><blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #e2e4f0;white-space:pre-wrap">${escapeHtml(preview)}</blockquote>`,
          url,
          'View bug',
        ),
        `${who} commented on ${ctx.title}:\n\n${preview}\n\n${url}`,
      );
    } catch (e) {
      this.logger.warn(`notifyComment failed: ${(e as Error).message}`);
    }
  }
}
