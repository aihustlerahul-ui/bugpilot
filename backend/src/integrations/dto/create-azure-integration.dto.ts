import { IsString, IsUrl } from 'class-validator'

export class CreateAzureIntegrationDto {
  @IsUrl()
  orgUrl: string

  @IsString()
  projectName: string

  @IsString()
  pat: string
}
