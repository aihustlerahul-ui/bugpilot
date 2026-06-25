import { IsObject, IsOptional, IsString, IsUrl } from 'class-validator'

export class CreateAzureIntegrationDto {
  @IsUrl()
  orgUrl: string

  @IsString()
  projectName: string

  @IsOptional()
  @IsString()
  pat?: string

  @IsOptional()
  @IsObject()
  fieldMapping?: Record<string, string>
}
