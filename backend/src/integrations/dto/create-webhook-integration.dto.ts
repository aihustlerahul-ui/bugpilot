import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn } from 'class-validator'

export class CreateWebhookIntegrationDto {
  @IsIn(['slack', 'teams'])
  @IsNotEmpty()
  provider: 'slack' | 'teams'

  @IsString()
  @IsNotEmpty()
  webhookUrl: string

  @IsString()
  @IsOptional()
  channelName?: string

  @IsArray()
  @IsOptional()
  notifyOnSeverity?: string[]

  @IsArray()
  @IsOptional()
  notifyOnStatus?: string[]
}
