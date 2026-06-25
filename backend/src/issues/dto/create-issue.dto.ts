import { IsOptional, IsString, IsObject } from 'class-validator'

export class CreateIssueDto {
  @IsString()
  project_id: string

  @IsOptional()
  @IsString()
  title?: string

  @IsString()
  description: string

  @IsOptional()
  @IsString()
  severity?: string

  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsString()
  route?: string

  @IsOptional()
  @IsObject()
  browser_info?: Record<string, unknown>

  @IsOptional()
  @IsObject()
  element_info?: Record<string, unknown>

  @IsOptional()
  @IsString()
  screenshot?: string

  @IsOptional()
  @IsString()
  element_screenshot?: string

  // Rich metadata: pageContext, performanceMetrics, appState, consoleErrors,
  // networkErrors, navigationHistory, form fields (expectedResult, priority…)
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}
