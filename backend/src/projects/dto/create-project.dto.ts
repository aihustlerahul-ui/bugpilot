import { IsEnum, IsString, MinLength } from 'class-validator'

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string

  @IsEnum(['auto', 'manual'])
  sync_mode: 'auto' | 'manual' = 'manual'
}
