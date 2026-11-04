import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RedispatchExecutionDto } from './redispatch-execution.dto';

describe('RedispatchExecutionDto', () => {
  it.each([false, 'true', undefined, 1])('rejects confirmation %s', async (confirmed) => {
    const errors = await validate(plainToInstance(RedispatchExecutionDto, { confirmed, configurationToken: 'a'.repeat(64) }));
    expect(errors.some((error) => error.property === 'confirmed')).toBe(true);
  });
  it('requires a configuration fingerprint', async () => {
    expect(await validate(plainToInstance(RedispatchExecutionDto, { confirmed: true }))).toHaveLength(1);
    expect(await validate(plainToInstance(RedispatchExecutionDto, { confirmed: true, configurationToken: 'a'.repeat(64) }))).toHaveLength(0);
  });
});
