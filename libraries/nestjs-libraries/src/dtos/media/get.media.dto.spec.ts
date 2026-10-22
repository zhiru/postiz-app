import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetMediaLibraryDto } from './get.media.dto';

describe('GetMediaLibraryDto', () => {
  it('accepts bounded pagination and known filters', async () => {
    const query = plainToInstance(GetMediaLibraryDto, {
      page: '2',
      limit: '24',
      type: 'image',
      sort: 'name',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query.limit).toBe(24);
  });

  it('accepts the JPEG/PNG thumbnail gallery filter', async () => {
    expect(
      await validate(
        plainToInstance(GetMediaLibraryDto, {
          type: 'image-static',
          limit: '12',
        })
      )
    ).toHaveLength(0);
  });

  it.each([
    { limit: '1000' },
    { limit: '-1' },
    { limit: 'NaN' },
    { limit: '2.5' },
    { type: 'pdf' },
    { sort: 'unknown' },
  ])('rejects invalid query %p', async (input) => {
    expect(
      (await validate(plainToInstance(GetMediaLibraryDto, input))).length
    ).toBeGreaterThan(0);
  });
});
