import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export enum ChunkUploadType {
  VIDEO = 'video',
  WEBCAM = 'webcam',
  THUMBNAIL = 'thumbnail',
  REPLAY = 'replay',
}

export class InitChunkUploadDto {
  @IsString()
  project_id: string;

  @IsEnum(ChunkUploadType)
  type: ChunkUploadType;

  @IsInt()
  @Min(1)
  total_chunks: number;

  @IsOptional()
  @IsInt()
  total_size?: number;

  @IsOptional()
  @IsString()
  filename?: string;
}

export class UploadChunkDto {
  @IsString()
  upload_id: string;

  @IsInt()
  @Min(0)
  chunk_index: number;

  @IsString()
  chunk_data: string; // Base64 encoded chunk
}

export class CompleteChunkUploadDto {
  @IsString()
  upload_id: string;

  @IsOptional()
  @IsString()
  issue_id?: string;
}
