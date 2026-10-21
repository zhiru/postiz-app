import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  Matches,
  ValidateNested,
} from 'class-validator';

export class ProviderAccountDto {
  @Matches(/^\d{1,40}$/)
  id: string;

  @Matches(/^\d{1,40}$/)
  pageId: string;
}

export class ConnectAccountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProviderAccountDto)
  accounts: ProviderAccountDto[];
}
