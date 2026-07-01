import { IsOptional, IsString } from 'class-validator'

export class AttachVideoDto {
  @IsString()
  videoStoragePath: string

  @IsOptional()
  @IsString()
  webcamStoragePath?: string
}
