import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BackfillReportDto {
  @IsString()
  integration: string;

  // Every provider caps how far back its analytics API answers, so this is only
  // an upper bound on what we ask for, not a promise of what comes back.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  days?: number;
}
