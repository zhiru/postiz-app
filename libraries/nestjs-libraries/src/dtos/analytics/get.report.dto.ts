import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class GetReportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  // Comma separated integration ids, or absent for every channel of the org.
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((id) => id.trim()).filter(Boolean)
      : value
  )
  integrations?: string[];

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}
