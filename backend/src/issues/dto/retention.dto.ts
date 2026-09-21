import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class RetentionCleanupDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  retention_days?: number;

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

export class PinIssueDto {
  @IsBoolean()
  pinned: boolean;
}

export class ResolveSourceMapDto {
  @IsOptional()
  url?: string;

  @IsOptional()
  stack?: string;

  @IsOptional()
  file?: string;

  @IsOptional()
  line?: number;

  @IsOptional()
  col?: number;
}
