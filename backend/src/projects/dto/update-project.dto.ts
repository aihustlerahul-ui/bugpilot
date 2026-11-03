import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator'

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @IsOptional()
  @IsEnum(['auto', 'manual'])
  sync_mode?: 'auto' | 'manual'

  @IsOptional()
  @IsObject()
  settings?: Record<string, any>
}
