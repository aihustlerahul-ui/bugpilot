import { IsString, MaxLength } from 'class-validator'

// Base64 inflates raw bytes by ~33% — 200MB here caps raw video around ~150MB.
const MAX_VIDEO_BASE64_LENGTH = 200 * 1024 * 1024

export class UploadVideoDto {
  @IsString()
  project_id: string

  @IsString()
  @MaxLength(MAX_VIDEO_BASE64_LENGTH, { message: 'Video too large' })
  video: string
}
