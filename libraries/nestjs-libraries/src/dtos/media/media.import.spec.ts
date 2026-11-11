/** @jest-environment node */
// Deliberately do not preload reflect-metadata: /settings imports this graph first.
describe('browser settings DTO import without metadata preload', () => {
  it('loads the settings DTO and retains nested media validation', async () => {
    expect((Reflect as any).getMetadata).toBeUndefined();
    const { UserDetailDto } = require('../users/user.details.dto');
    const { MediaDto } = require('./media.dto');
    const { plainToInstance } = require('class-transformer');
    const { validate } = require('class-validator');
    expect(typeof (Reflect as any).getMetadata).toBe('function');
    expect(
      await validate(Object.assign(new UserDetailDto(), { fullname: 'A' }))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'fullname' }),
      ])
    );
    const invalid = plainToInstance(MediaDto, {
      id: 'm',
      path: '/uploads/photo.jpg',
      user_tags: [{ username: 'person', x: 2, y: 0.5 }],
    });
    expect(await validate(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'user_tags' }),
      ])
    );
  });
});
