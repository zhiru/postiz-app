import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FlowExecutionsQueryDto } from './flow-executions-query.dto';

describe('FlowExecutionsQueryDto', () => {
  it('transforms and validates bounded page parameters and supported filters', async () => {
    const query = plainToInstance(FlowExecutionsQueryDto, {
      paginated: 'true',
      page: '2',
      limit: '50',
      status: 'WAITING_POSTBACK',
      search: 'Ana',
      since: '2026-11-01T03:00:00.000Z',
      order: 'asc',
    });
    expect(await validate(query)).toEqual([]);
    expect(query.page).toBe(2);
    expect(query.limit).toBe(50);
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { page: 'nope' },
    { limit: '101' },
    { limit: '-1' },
    { status: 'UNKNOWN' },
    { search: 'a'.repeat(201) },
    { since: 'invalid' },
    { until: '2026-02-30' },
    { order: 'random' },
    { paginated: 'false' },
    { search: ['a', 'b'] },
  ])('rejects invalid query %j', async (input) => {
    expect(
      (await validate(plainToInstance(FlowExecutionsQueryDto, input))).length
    ).toBeGreaterThan(0);
  });
});
