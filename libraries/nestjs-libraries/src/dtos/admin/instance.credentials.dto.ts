import { IsObject } from 'class-validator';

export class InstanceCredentialsDto {
  // key -> new value; empty string or null removes it (back to the .env value)
  @IsObject()
  values: Record<string, string | null>;
}
