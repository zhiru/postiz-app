import { IsDateString } from 'class-validator';
import { IsDefined, IsObject } from 'class-validator';

export class UpdatePostSettingsDto {
  @IsDateString()
  version: string;
  @IsDefined()
  @IsObject()
  settings: Record<string, any>;
}
