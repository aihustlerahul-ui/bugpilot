import { IsOptional, IsString, IsObject } from 'class-validator'

export class CreateIssueDto {
  @IsString()
  project_id: string

  @IsString()
  description: string

  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsString()
  route?: string

  @IsOptional()
  @IsObject()
  browser_info?: Record<string, string>

  @IsOptional()
  @IsObject()
  element_info?: Record<string, string>

  @IsOptional()
  @IsString()
  screenshot?: string  // base64

  @IsOptional()
  @IsString()
  element_screenshot?: string  // base64
}
