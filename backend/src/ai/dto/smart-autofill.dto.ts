import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray } from 'class-validator'

export class SmartAutofillDto {
  @IsString()
  @IsNotEmpty()
  userInput: string

  @IsObject()
  @IsOptional()
  domContext?: {
    page?: { title: string; path: string }
    container?: { tag: string; role: string | null; label: string | null } | null
    heading?: string | null
    siblings?: Array<{ tag: string; role: string | null; name: string | null; value: string | null }>
    target?: { tag: string; role: string | null; name: string | null; value: string | null; action: string }
    rawSummary?: string
  }

  @IsObject()
  @IsOptional()
  elementInfo?: Record<string, any>

  @IsArray()
  @IsOptional()
  consoleErrors?: Array<{ level: string; message: string; timestamp?: number }>

  @IsArray()
  @IsOptional()
  networkErrors?: Array<{ method: string; url: string; status: number | string; duration?: number }>

  @IsString()
  @IsOptional()
  url?: string

  @IsString()
  @IsOptional()
  route?: string
}
