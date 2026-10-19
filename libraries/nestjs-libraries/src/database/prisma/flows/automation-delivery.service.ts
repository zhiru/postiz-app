import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '../prisma.service';

@Injectable()
export class AutomationDeliveryService {
  constructor(private repository: PrismaRepository<'automationDelivery'>) {}

  async sendOnce(key: string, send: () => Promise<unknown>) {
    const model = this.repository.model.automationDelivery;
    try {
      await model.create({ data: { key, status: 'SENDING' } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const previous = await model.findUnique({ where: { key } });
      if (previous?.status === 'SENT') return;
      throw new Error(
        'Delivery confirmation unavailable. Check Instagram before taking any manual action. Automatic resend blocked.'
      );
    }

    // A timeout may follow a successful external effect. Never reopen this claim,
    // even if the process dies before the request or before recording its result.
    try {
      const result = await send();
      const providerId =
        (result as { id?: unknown; messageId?: unknown })?.id ||
        (result as { messageId?: unknown })?.messageId;
      await model.update({
        where: { key },
        data: {
          status: 'SENT',
          providerId: typeof providerId === 'string' ? providerId : null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const rejected = (error as { outcome?: string }).outcome === 'rejected';
      await model
        .update({
          where: { key },
          data: {
            status: rejected ? 'REJECTED' : 'UNKNOWN',
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw new Error(
        rejected
          ? 'Instagram rejected this delivery. Check the channel permissions. Automatic resend blocked.'
          : 'Delivery confirmation unavailable. Check Instagram before taking any manual action. Automatic resend blocked.'
      );
    }
  }
}
