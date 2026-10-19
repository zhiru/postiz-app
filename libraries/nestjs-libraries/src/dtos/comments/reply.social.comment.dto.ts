import { IsBoolean, IsDefined, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReplySocialCommentDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(2200)
  message: string;

  // Set by an automation (n8n, an agent) that wants the text queued for a
  // human to approve instead of sent. Ignored for replies typed by a user.
  @IsBoolean()
  @IsOptional()
  suggestion?: boolean;
}
