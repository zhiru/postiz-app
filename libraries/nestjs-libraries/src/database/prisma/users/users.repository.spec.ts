import { Provider } from '@prisma/client';
import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { UsersRepository } from './users.repository';

describe('UsersRepository', () => {
  it('busca conta local por email sem diferenciar maiusculas e minusculas', async () => {
    const prisma = createPrismaRepositoryMock('user');
    prisma.model.user.findFirst.mockResolvedValue(null);
    const repository = new UsersRepository(prisma as any, {} as any);

    await repository.getUserByEmail('Legacy.User@Example.COM');

    expect(prisma.model.user.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        email: {
          equals: 'Legacy.User@Example.COM',
          mode: 'insensitive',
        },
        providerName: Provider.LOCAL,
      },
      include: {
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });
  });
});

describe('UsersRepository timezone preference', () => {
  it.each(['America/Sao_Paulo', null])(
    'changes only the authenticated user preference and returns no credential row',
    async (timezoneName) => {
      const prisma = createPrismaRepositoryMock('user');
      prisma.model.user.update.mockResolvedValue({
        id: 'authenticated-user',
      } as any);
      const result = await new UsersRepository(
        prisma as any,
        {} as any
      ).updateTimezone('authenticated-user', { timezoneName } as any);
      expect(prisma.model.user.update).toHaveBeenCalledWith({
        where: { id: 'authenticated-user' },
        data: { timezoneName },
        select: { id: true },
      });
      expect(result).toBeUndefined();
    }
  );
});
