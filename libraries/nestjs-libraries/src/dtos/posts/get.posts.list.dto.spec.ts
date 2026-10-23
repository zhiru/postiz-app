import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetPostsListDto } from './get.posts.list.dto';

describe('GetPostsListDto date filters', () => {
  it('accepts ISO boundaries and preserves existing optional filters', () => {
    const query = plainToInstance(GetPostsListDto, {
      startDate: '2026-10-23T03:00:00.000Z',
      endDate: '2026-10-24T02:59:59.999Z',
      page: '2',
      limit: '10',
      state: 'draft',
      integrations: 'a,b',
    });
    expect(validateSync(query)).toEqual([]);
    expect(query).toMatchObject({
      page: 2,
      limit: 10,
      integrations: ['a', 'b'],
      state: 'draft',
    });
    expect(validateSync(new GetPostsListDto())).toEqual([]);
  });
  it('rejects malformed dates before reaching the repository', () => {
    const query = plainToInstance(GetPostsListDto, {
      startDate: '2026-02-30',
      endDate: 'not-a-date',
    });
    expect(validateSync(query).map((error) => error.property)).toEqual(
      expect.arrayContaining(['startDate', 'endDate'])
    );
  });
});
