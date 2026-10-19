import { AutomationDeliveryService } from './automation-delivery.service';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('AutomationDeliveryService', () => {
  let rows: Map<string, any>;
  let model: any;
  let service: AutomationDeliveryService;
  beforeEach(() => {
    rows = new Map();
    model = {
      create: jest.fn(async ({ data }) => {
        if (rows.has(data.key)) throw { code: 'P2002' };
        rows.set(data.key, { ...data });
        return data;
      }),
      findUnique: jest.fn(async ({ where }) => rows.get(where.key)),
      update: jest.fn(async ({ where, data }) => {
        Object.assign(rows.get(where.key), data);
        return rows.get(where.key);
      }),
    };
    service = new AutomationDeliveryService({
      model: { automationDelivery: model },
    } as any);
  });

  it('envia uma vez mesmo com concorrencia e redelivery', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'remote' });
    await Promise.allSettled([
      service.sendOnce('key', send),
      service.sendOnce('key', send),
    ]);
    await service.sendOnce('key', send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows.get('key')).toMatchObject({
      status: 'SENT',
      providerId: 'remote',
    });
  });

  it('nao repete depois de timeout ou reinicio', async () => {
    const send = jest.fn().mockRejectedValue(new Error('sensitive-token'));
    await expect(service.sendOnce('key', send)).rejects.not.toThrow(
      'sensitive-token'
    );
    await expect(service.sendOnce('key', send)).rejects.toThrow('confirmation');
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows.get('key').status).toBe('UNKNOWN');
  });

  it('nao reenvia se a confirmacao no banco falhar apos sucesso externo', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'remote' });
    model.update.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.sendOnce('key', send)).rejects.toThrow('confirmation');
    await expect(service.sendOnce('key', send)).rejects.toThrow('confirmation');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('nao chama a rede se a reserva no banco falhar', async () => {
    model.create.mockRejectedValueOnce(new Error('DB unavailable'));
    const send = jest.fn();
    await expect(service.sendOnce('key', send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

const databaseUrl = process.env.POSTIZ_SYNC_TEST_DATABASE_URL;
if (
  databaseUrl &&
  (!['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname) ||
    !new URL(databaseUrl).pathname.endsWith('_test'))
) {
  throw new Error('Use a disposable local database ending in _test');
}

(databaseUrl ? describe : describe.skip)(
  'AutomationDelivery PostgreSQL',
  () => {
    const db = new PrismaClient({
      datasources: {
        db: { url: databaseUrl || 'postgresql://localhost/unused_test' },
      },
    });
    const keys: string[] = [];
    const service = new AutomationDeliveryService({ model: db } as any);
    afterAll(async () => {
      await db.automationDelivery.deleteMany({ where: { key: { in: keys } } });
      await db.$disconnect();
    });

    it('bloqueia concorrencia no banco e preserva a confirmacao', async () => {
      const key = randomUUID();
      keys.push(key);
      const send = jest.fn().mockResolvedValue({ messageId: 'meta-confirmed' });
      await Promise.allSettled(
        Array.from({ length: 12 }, () => service.sendOnce(key, send))
      );
      await service.sendOnce(key, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await db.automationDelivery.findUnique({ where: { key } })
      ).toMatchObject({ status: 'SENT', providerId: 'meta-confirmed' });
    });

    it('nao reabre um resultado incerto em outra instancia do servico', async () => {
      const key = randomUUID();
      keys.push(key);
      const send = jest
        .fn()
        .mockRejectedValue(new Error('Timeout after external acceptance'));
      await expect(service.sendOnce(key, send)).rejects.toThrow('confirmation');
      const restarted = new AutomationDeliveryService({ model: db } as any);
      await expect(restarted.sendOnce(key, send)).rejects.toThrow(
        'confirmation'
      );
      expect(send).toHaveBeenCalledTimes(1);
    });
  }
);
