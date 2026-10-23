jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/analytics/post-metrics.service',
  () => ({ PostMetricsService: class {} })
);
import { PublicAnalyticsController } from './public.analytics.controller';
import { GetAnalyticsPostsDto } from '@gitroom/nestjs-libraries/dtos/analytics/get.analytics.posts.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
describe('public analytics', () => {
  it('delegates only authenticated organization/profile and never refreshes', async () => {
    const service = {
      summary: jest.fn(),
      listPosts: jest.fn(),
      getPost: jest.fn(),
      refresh: jest.fn(),
    };
    const controller = new PublicAnalyticsController(service as any);
    await controller.summary({ id: 'trusted' } as any, 'profile', { date: 7 });
    await controller.posts({ id: 'trusted' } as any, 'profile', {
      format: 'story',
    });
    await controller.post({ id: 'trusted' } as any, 'profile', 'p', 'cursor');
    expect(service.summary).toHaveBeenCalledWith(
      'trusted',
      { date: 7 },
      'profile'
    );
    expect(service.listPosts).toHaveBeenCalledWith(
      'trusted',
      { format: 'story' },
      'profile'
    );
    expect(service.getPost).toHaveBeenCalledWith(
      'trusted',
      'p',
      'profile',
      'cursor'
    );
    expect(service.refresh).not.toHaveBeenCalled();
  });
  it.each([
    { date: 0 },
    { date: 367 },
    { limit: 101 },
    { page: -1 },
    { from: 'bad' },
    { from: '2026-10-23' },
    { format: 'invalid' },
    { q: 'a'.repeat(201) },
  ])('rejects invalid query bounds %j', async (query) => {
    expect(
      (await validate(plainToInstance(GetAnalyticsPostsDto, query))).length
    ).toBeGreaterThan(0);
  });
});
