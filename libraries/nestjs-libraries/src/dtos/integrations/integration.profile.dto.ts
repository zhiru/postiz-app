import { IsDefined, IsString } from 'class-validator';

export class IntegrationProfileDto {
  @IsString()
  @IsDefined()
  profileId: string;
}
