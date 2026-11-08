import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MediaDto } from './media.dto';
import { InstagramDto } from '../posts/providers-settings/instagram.dto';
import { managedMediaSchema } from '../posts/manage.post.dto';

describe('Instagram people metadata', () => {
  const tag = { username: '@Person', x: 0, y: 1 };
  it.each([4, 5])('accepts %i collaborators and rejects six', async (count) => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      collaborators: Array.from({ length: count }, (_, i) => ({
        label: `@person${i}`,
      })),
    });
    expect(await validate(dto)).toHaveLength(0);
    dto.collaborators = Array.from({ length: 6 }, (_, i) => ({
      label: `person${i}`,
    }));
    expect(await validate(dto)).not.toHaveLength(0);
  });
  it('rejects duplicate collaborator handles regardless of @ or case', async () => {
    const dto = plainToInstance(InstagramDto, {
      post_type: 'post',
      collaborators: [{ label: '@Person' }, { label: 'person' }],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
  it.each(
    [
      [{ ...tag, x: -0.1 }],
      [{ ...tag, y: 1.1 }],
      [{ ...tag, x: NaN }],
      [{ ...tag, y: Infinity }],
      [{ ...tag, x: '0.5' }],
      [{ username: 'person', x: 0.5 }],
      [{ ...tag, username: 'https://instagram.com/person' }],
      [tag, { ...tag, username: 'person' }],
    ].map((user_tags) => ({ user_tags }))
  )('rejects invalid per-image tags %j', async ({ user_tags }) => {
    const dto = plainToInstance(MediaDto, {
      id: 'm',
      path: '/a.jpg',
      user_tags,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'user_tags')).toBe(true);
    expect(managedMediaSchema.safeParse({ id: 'm', user_tags }).success).toBe(
      false
    );
  });
  it.each([123, {}, null, undefined])(
    'returns field errors for malformed usernames %j',
    async (username) => {
      const dto = plainToInstance(MediaDto, {
        id: 'm',
        path: '/a.jpg',
        user_tags: [{ username, x: 0.5, y: 0.5 }],
      });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'user_tags')).toBe(true);
      const settings = plainToInstance(InstagramDto, {
        post_type: 'post',
        collaborators: [{ label: username }],
      });
      expect(
        (await validate(settings)).some(
          (error) => error.property === 'collaborators'
        )
      ).toBe(true);
    }
  );
  it('returns field errors for null nested items', async () => {
    const dto = plainToInstance(MediaDto, {
      id: 'm',
      path: '/a.jpg',
      user_tags: [null],
    });
    expect(
      (await validate(dto)).some((error) => error.property === 'user_tags')
    ).toBe(true);
    const settings = plainToInstance(InstagramDto, {
      post_type: 'post',
      collaborators: [null],
    });
    expect(
      (await validate(settings)).some(
        (error) => error.property === 'collaborators'
      )
    ).toBe(true);
  });
  it('normalizes handles without changing coordinates and supports explicit clearing', async () => {
    const dto = plainToInstance(MediaDto, {
      id: 'm',
      path: '/a.jpg',
      user_tags: [tag],
    });
    expect(dto.user_tags).toEqual([{ username: 'Person', x: 0, y: 1 }]);
    expect(managedMediaSchema.parse({ id: 'm', user_tags: [] })).toEqual({
      id: 'm',
      user_tags: [],
    });
    expect(
      managedMediaSchema.parse({ id: 'm', user_tags: [tag] }).user_tags
    ).toEqual(dto.user_tags);
  });
});
