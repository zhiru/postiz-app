import {
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export type NeuralTalkAccount = { id: string; name: string };
export type NeuralTalkInbox = {
  id: string;
  name: string;
  channelType: string;
  supportsGroups: boolean;
  available: boolean;
};
export type NeuralTalkDestination = {
  id: string;
  name: string;
  kind: 'contact' | 'group';
};
export type NeuralTalkDestinationPage = {
  items: NeuralTalkDestination[];
  hasMore: boolean;
  page: number;
};
export class NeuralTalkCredentialsDto {
  @ApiPropertyOptional({
    example: 'https://chat.neuraltalk.com.br',
    description: 'Required with apiToken when not reusing a saved connection.',
  })
  @ValidateIf((o) => o.useSavedConnection !== true && !o.savedIntegrationId)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  baseUrl?: string;
  @ApiPropertyOptional({ format: 'password', writeOnly: true })
  @ValidateIf((o) => o.useSavedConnection !== true && !o.savedIntegrationId)
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @Matches(/^\S+$/)
  apiToken?: string;

  @ApiPropertyOptional({
    description:
      'Reuse the saved connection from the authenticated profile. Cannot be combined with URL, token or savedIntegrationId.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  useSavedConnection?: boolean;

  @ApiPropertyOptional({
    description:
      'Reuse a NeuralTalk channel from the authenticated profile without returning its credential. Cannot be combined with URL, token or useSavedConnection.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9-]{1,100}$/)
  savedIntegrationId?: string;
}
export class NeuralTalkAccountsDto extends NeuralTalkCredentialsDto {
  @ApiPropertyOptional({
    description:
      'Save the validated server and token for this profile only. Existing channel credentials remain unchanged.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  saveAsDefault?: boolean;
}
export class NeuralTalkAccountDto extends NeuralTalkCredentialsDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-zA-Z0-9-]{1,100}$/)
  accountId: string;
}
export class NeuralTalkConnectDto extends NeuralTalkAccountDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[1-9][0-9]{0,18}$/)
  inboxId: string;
}
