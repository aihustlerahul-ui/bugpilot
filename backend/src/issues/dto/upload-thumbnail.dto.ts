import { IsString, MaxLength } from 'class-validator'

// JPEG thumbnails are small (single video frame) — 5MB base64 is generous headroom.
const MAX_THUMBNAIL_BASE64_LENGTH = 5 * 1024 * 1024

export class UploadThumbnailDto {
  @IsString()
  project_id: string

  @IsString()
  @MaxLength(MAX_THUMBNAIL_BASE64_LENGTH, { message: 'Thumbnail too large' })
  thumbnail: string
}
