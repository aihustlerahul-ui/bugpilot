import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: 'body must not be empty or whitespace only' })
  body: string;
}
