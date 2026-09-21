import { IsString, IsNotEmpty, IsOptional, IsArray, IsObject } from 'class-validator'

export class GeneratePlaywrightTestDto {
  @IsString()
  @IsNotEmpty()
  title: string

  @IsString()
  @IsOptional()
  url?: string

  @IsArray()
  @IsOptional()
  breadcrumbs?: Array<{
    type: string
    category?: string
    message: string
    timestamp: number
    data?: Record<string, any>
  }>

  @IsArray()
  @IsOptional()
  rrwebEvents?: any[]

  @IsObject()
  @IsOptional()
  elementInfo?: Record<string, any>
}
