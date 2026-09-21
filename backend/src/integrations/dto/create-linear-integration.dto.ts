import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator'

export class CreateLinearIntegrationDto {
  @IsString()
  @IsNotEmpty()
  apiKey: string

  @IsString()
  @IsNotEmpty()
  teamId: string

  @IsString()
  @IsOptional()
  projectId?: string

  @IsObject()
  @IsOptional()
  fieldMapping?: Record<string, string>
}
