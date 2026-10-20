import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { TrackEnum } from '../user/track.enum';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: jest.fn() },
    invoices: { list: jest.fn(), retrieve: jest.fn() },
  }))
);

describe('Stripe conversion tracking', () => {
  const stripe = (Stripe as unknown as jest.Mock).mock.results[0].value;
  const users = { getUserById: jest.fn() };
  const tracking = { track: jest.fn() };
  const service = new StripeService(
    {} as any,
    {} as any,
    users as any,
    tracking as any
  );
  const invoice = {
    id: 'in_2',
    amount_paid: 1000,
    currency: 'brl',
    created: 200,
    parent: { subscription_details: { subscription: 'sub_1' } },
  };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  it('ignores zero invoices and other services on a shared Stripe account', async () => {
    await (service as any).trackConversion({ ...invoice, amount_paid: 0 });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    stripe.subscriptions.retrieve.mockResolvedValue({
      metadata: { service: 'other', userId: 'u' },
    });
    await (service as any).trackConversion(invoice);
    expect(tracking.track).not.toHaveBeenCalled();
  });
  it('tracks only the first paid invoice, with its stable provider identity', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: { service: 'gitroom', userId: 'u' },
    });
    stripe.invoices.list.mockResolvedValue({ data: [invoice] });
    users.getUserById.mockResolvedValue({ id: 'u', ip: 'ip', agent: 'agent' });
    tracking.track.mockResolvedValue(undefined);
    await (service as any).trackConversion(invoice);
    expect(tracking.track).toHaveBeenCalledWith(
      'in_2',
      'ip',
      'agent',
      TrackEnum.Purchase,
      { value: 10, currency: 'brl' },
      undefined,
      expect.any(Object),
      undefined
    );
    tracking.track.mockClear();
    stripe.invoices.list.mockResolvedValue({
      data: [{ id: 'in_1', amount_paid: 1000, created: 100 }],
    });
    await (service as any).trackConversion(invoice);
    expect(tracking.track).not.toHaveBeenCalled();
  });
  it('acknowledges the webhook even when conversion tracking fails', async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(
      new Error('provider unavailable')
    );
    await expect(
      service.paymentSucceeded({ data: { object: invoice } } as any)
    ).resolves.toEqual({ ok: true });
    await expect(
      (service as any).trackConversion(invoice)
    ).resolves.toBeUndefined();
  });

  it.each(['requires_action','requires_confirmation'])('returns the customer 3DS secret for %s', async status=>{
    stripe.subscriptions.retrieve.mockResolvedValue({latest_invoice:{id:'in_3ds'}});
    stripe.invoices.retrieve.mockResolvedValue({status:'open',payments:{data:[{payment:{payment_intent:{status,client_secret:'demo_client_secret'}}}]}});
    await expect((service as any).getRequiredActionFromSubscription('sub_3ds')).resolves.toEqual({requiresAction:true,clientSecret:'demo_client_secret'});
  });
  it('rejects a declined interactive charge rather than reporting success',async()=>{
    stripe.subscriptions.retrieve.mockResolvedValue({latest_invoice:{id:'in_declined'}});
    stripe.invoices.retrieve.mockResolvedValue({status:'open',payments:{data:[{payment:{payment_intent:{status:'requires_payment_method'}}}]}});
    await expect((service as any).getRequiredActionFromSubscription('sub_declined')).rejects.toThrow('subscription payment failed');
  });
  it('does not request action after the invoice is paid',async()=>{
    stripe.subscriptions.retrieve.mockResolvedValue({latest_invoice:{id:'in_paid'}});
    stripe.invoices.retrieve.mockResolvedValue({status:'paid',payments:{data:[]}});
    await expect((service as any).getRequiredActionFromSubscription('sub_paid')).resolves.toEqual({requiresAction:false});
  });
});
