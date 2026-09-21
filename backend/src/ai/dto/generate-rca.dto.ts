import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray } from 'class-validator'

export class GenerateRcaDto {
  @IsString()
  @IsNotEmpty()
  title: string

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsOptional()
  url?: string

  @IsString()
  @IsOptional()
  route?: string

  @IsString()
  @IsOptional()
  severity?: string

  @IsObject()
  @IsOptional()
  elementInfo?: Record<string, any>

  @IsArray()
  @IsOptional()
  consoleErrors?: Array<{ level: string; message: string; timestamp?: number }>

  @IsArray()
  @IsOptional()
  networkErrors?: Array<{ method: string; url: string; status: number | string; duration?: number }>

  @IsArray()
  @IsOptional()
  breadcrumbs?: Array<{ type: string; category?: string; message: string; timestamp: number }>
}
