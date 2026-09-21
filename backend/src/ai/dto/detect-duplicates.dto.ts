import { IsString, IsNotEmpty, IsOptional, IsArray, IsObject } from 'class-validator'

export class DetectDuplicatesDto {
  @IsString()
  @IsNotEmpty()
  projectId: string

  @IsString()
  @IsNotEmpty()
  title: string

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsOptional()
  url?: string

  @IsObject()
  @IsOptional()
  elementInfo?: Record<string, any>

  @IsArray()
  @IsOptional()
  consoleErrors?: Array<{ message: string }>

  @IsArray()
  @IsOptional()
  networkErrors?: Array<{ url: string; status: number | string }>
}
