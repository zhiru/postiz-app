import {
  IsOptional,
  IsNumber,
  IsString,
  Min,
  IsInt,
  IsIn,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GetMediaDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsString()
  search?: string;
}

export class GetMediaLibraryDto extends GetMediaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 18;

  @IsOptional()
  @IsIn(['all', 'image', 'image-static', 'video'])
  type: 'all' | 'image' | 'image-static' | 'video' = 'all';

  @IsOptional()
  @IsIn(['newest', 'oldest', 'name'])
  sort: 'newest' | 'oldest' | 'name' = 'newest';
}

export type MediaLibraryOptions = Partial<
  Pick<GetMediaLibraryDto, 'limit' | 'type' | 'sort'>
>;
