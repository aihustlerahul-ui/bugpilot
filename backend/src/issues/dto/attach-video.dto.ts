import { IsString } from 'class-validator'

export class AttachVideoDto {
  @IsString()
  videoStoragePath: string
}
