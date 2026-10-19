import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TimezoneDto } from './timezone.dto';

describe('TimezoneDto', () => {
  it.each(['America/Sao_Paulo', 'America/New_York', null, undefined])(
    'accepts a valid or automatic preference: %s',
    async (timezoneName) => {
      expect(
        await validate(plainToInstance(TimezoneDto, { timezoneName }))
      ).toHaveLength(0);
    }
  );
  it.each(['invalid/timezone', '<script>', 123])(
    'rejects invalid preferences: %s',
    async (timezoneName) => {
      expect(
        (await validate(plainToInstance(TimezoneDto, { timezoneName }))).length
      ).toBeGreaterThan(0);
    }
  );
});
