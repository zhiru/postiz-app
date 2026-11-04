import { Equals, IsHexadecimal, Length } from 'class-validator';

export class RedispatchExecutionDto {
  @Equals(true)
  confirmed: boolean;

  @IsHexadecimal()
  @Length(64, 64)
  configurationToken: string;
}
