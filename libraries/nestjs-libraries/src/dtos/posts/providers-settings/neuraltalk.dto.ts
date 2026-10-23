import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class NeuralTalkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^(contact|group):[1-9]\d*$/, { each: true })
  @JSONSchema({
    description:
      'Selected NeuralTalk contact IDs in this inbox, prefixed contact: or group:. Groups are existing Hermes contacts, never arbitrary WhatsApp identifiers.',
  })
  targets: string[];
}
