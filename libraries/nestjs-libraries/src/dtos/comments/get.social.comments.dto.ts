import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export const SOCIAL_COMMENT_STATUSES = [
  'RECEIVED',
  'PENDING_APPROVAL',
  'REPLIED',
  'IGNORED',
];

export class GetSocialCommentsDto {
  @IsString()
  @IsOptional()
  integrationId?: string;

  @IsString()
  @IsOptional()
  postId?: string;

  @IsIn(SOCIAL_COMMENT_STATUSES)
  @IsOptional()
  status?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number;
}
