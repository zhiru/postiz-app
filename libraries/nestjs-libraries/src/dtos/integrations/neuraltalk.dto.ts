import {
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'https://chat.neuraltalk.com.br' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  baseUrl: string;
  @ApiProperty({ format: 'password', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @Matches(/^\S+$/)
  apiToken: string;
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
