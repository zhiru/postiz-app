import { runWithContext } from '../async.storage';
import { readRequestContext } from './tool.context.helper';

describe('tool context - MCP sem requestContext', () => {
  it('recupera somente organizacao e perfil autenticados do AsyncLocalStorage', async () => {
    await runWithContext({ requestId: 'request-1', auth: { id: 'org-1' }, profileId: 'profile-1' }, async () => {
      const context = readRequestContext({});
      expect(JSON.parse(context.get('organization') as string)).toEqual({ id: 'org-1' });
      expect(context.get('profileId')).toBe('profile-1');
      expect(context.get('token')).toBeUndefined();
    });
  });
  it('mantem o contexto interno de persona e perfil', () => {
    const context = new Map([['profileId', 'profile-2'], ['persona', 'marca']]);
    expect(readRequestContext({ requestContext: context }).get('persona')).toBe('marca');
  });
});
