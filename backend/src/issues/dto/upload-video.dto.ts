import { IsString } from 'class-validator'

export class UploadVideoDto {
  @IsString()
  project_id: string

  @IsString()
  video: string
}
