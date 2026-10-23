import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  Matches,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class GetAnalyticsPostsDto {
  @ApiPropertyOptional({
    default: 30,
    minimum: 1,
    maximum: 366,
    description:
      'Number of publication days, UTC; use from/to for explicit bounds.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  @Transform(({ value }) => Number(value))
  date?: number = 30;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, {
    message: 'Use an ISO timestamp with an explicit UTC offset.',
  })
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, {
    message: 'Use an ISO timestamp with an explicit UTC offset.',
  })
  to?: string;
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => Number(value))
  page?: number = 0;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => Number(value))
  limit?: number = 20;
  @ApiPropertyOptional({
    enum: [
      'reactions',
      'comments',
      'views',
      'impressions',
      'reach',
      'engagement',
      'published',
    ],
  })
  @IsOptional()
  @IsIn([
    'reactions',
    'comments',
    'views',
    'impressions',
    'reach',
    'engagement',
    'published',
  ])
  sort?: string = 'reactions';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({})
  @IsOptional()
  @IsString()
  @MaxLength(200)
  integrationId?: string;
  @ApiPropertyOptional({})
  @IsOptional()
  @IsString()
  @MaxLength(200)
  platform?: string;
  @ApiPropertyOptional({})
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
  @ApiPropertyOptional({ enum: ['all', 'post', 'story', 'video', 'carousel'] })
  @IsOptional()
  @IsIn(['all', 'post', 'story', 'video', 'carousel'])
  format?: string = 'all';
}
