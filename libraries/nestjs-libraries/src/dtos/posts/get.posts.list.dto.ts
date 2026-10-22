import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsArray,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { PostFormat } from '@gitroom/helpers/utils/posts.list.minify';

export type PostListStateFilter =
  | 'all'
  | 'scheduled'
  | 'draft'
  | 'published'
  | 'overdue'
  | 'error';

export class GetPostsListDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  customer?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (value ? value.split(',') : []))
  integrations?: string[];

  @IsOptional()
  @IsIn(['all', 'scheduled', 'draft', 'published', 'overdue', 'error'])
  state?: PostListStateFilter = 'all';

  @IsOptional()
  @IsIn(['all', 'post', 'story', 'video', 'carousel'])
  format?: PostFormat | 'all' = 'all';

  @IsOptional()
  @IsString()
  search?: string;
}
