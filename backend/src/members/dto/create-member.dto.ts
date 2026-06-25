import { IsEmail, IsString, MinLength } from 'class-validator'

export class CreateMemberDto {
  @IsString()
  @MinLength(1)
  name: string

  @IsEmail()
  email: string
}
