import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator'

export class CreateJiraIntegrationDto {
  @IsString()
  @IsNotEmpty()
  host: string

  @IsString()
  @IsNotEmpty()
  email: string

  @IsString()
  @IsOptional()
  apiToken?: string

  @IsString()
  @IsNotEmpty()
  projectKey: string

  @IsString()
  @IsOptional()
  issueType?: string

  @IsObject()
  @IsOptional()
  fieldMapping?: Record<string, string>
}
