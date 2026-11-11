// Shared with browser settings: decorators need metadata before evaluation.
import 'reflect-metadata';

import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  ValidateIf,
  Validate,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

export class ImageUserTag {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/^@/, '') : value
  )
  @IsString()
  @Matches(/^[A-Za-z0-9._]{1,30}$/, {
    message: 'Use an Instagram username, not a URL or caption mention',
  })
  username: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  x: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  y: number;
}

export class MediaDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique(
    (tag: ImageUserTag) =>
      typeof tag?.username === 'string'
        ? tag.username.toLowerCase()
        : tag?.username,
    { message: 'Tag each username only once per image' }
  )
  @Type(() => ImageUserTag)
  @ValidateNested({ each: true })
  user_tags?: ImageUserTag[];

  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  @Validate(ValidUrlPath)
  @Validate(ValidUrlExtension)
  path: string;

  @ValidateIf((o) => o.alt)
  @IsString()
  alt?: string;

  @ValidateIf((o) => o.thumbnail)
  @IsUrl()
  thumbnail?: string;
}
