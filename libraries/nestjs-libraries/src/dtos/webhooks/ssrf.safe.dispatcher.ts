import { Agent, buildConnector } from 'undici';
import axios, { AxiosInstance } from 'axios';
import dns from 'node:dns';
import net, { LookupFunction } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isBlockedIp, isSsrfProtectionDisabled } from './webhook.url.validator';

// Pins DNS resolution: every resolved IP is checked with `isBlockedIp` and
// the caller (undici) connects to that same set. Closes the TOCTOU window
// `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
type SsrfLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: any,
  family?: number
) => void;

/**
 * Lookup compartilhado por Undici e Axios. A verificacao acontece no momento
 * da conexao e o cliente usa exatamente o endereco aprovado, fechando a janela
 * de DNS rebinding entre uma validacao previa e o request real.
 */
export function ssrfSafeLookup(
  hostname: string,
  options: any,
  callback: SsrfLookupCallback
): void {
  if (net.isIP(hostname)) {
    const family = net.isIP(hostname);
    if (isBlockedIp(hostname, hostname)) {
      callback(new Error('Blocked IP'), '', 0);
      return;
    }

    if (options?.all) {
      callback(null, [{ address: hostname, family }], family);
      return;
    }

    callback(null, hostname, family);
    return;
  }

  dns.lookup(hostname, options, (error, address: any, family: any) => {
    if (error) {
      callback(error, '', 0);
      return;
    }

    if (Array.isArray(address)) {
      if (address.some((entry) => isBlockedIp(entry.address, hostname))) {
        callback(new Error('Blocked IP'), '', 0);
        return;
      }

      callback(null, address, 0);
      return;
    }

    if (isBlockedIp(address, hostname)) {
      callback(new Error('Blocked IP'), '', 0);
      return;
    }

    callback(null, address, family);
  });
}

// Node never calls `lookup` when the host is already an IP literal
// (http://169.254.169.254, http://10.0.0.5, decimal forms the URL parser
// normalises), so those have to be rejected at connect time as well.
// Redirect hops open their connection through the same path.
function isBlockedLiteralHost(host?: string | null) {
  const hostname = (host || '').replace(/^\[|\]$/g, '');
  return !!net.isIP(hostname) && isBlockedIp(hostname, hostname);
}

// Connect options (timeout, allowH2, ...) belong here, not on the Agent:
// a custom `connect` function makes the Agent ignore its own connect options
const ssrfSafeConnector = buildConnector({
  lookup: ssrfSafeLookup,
} as buildConnector.BuildOptions);

export const ssrfSafeDispatcher = new Agent({
  connect: (options, callback) => {
    if (isBlockedLiteralHost(options.hostname)) {
      return callback(new Error('Blocked IP'), null);
    }
    return ssrfSafeConnector(options, callback);
  },
});

function withLiteralIpGuard<T extends http.Agent>(agent: T): T {
  const createConnection = (agent as any).createConnection.bind(agent);
  (agent as any).createConnection = (options: any, callback: any) => {
    if (isBlockedLiteralHost(options.host)) {
      return callback(new Error('Blocked IP'));
    }
    return createConnection(options, callback);
  };
  return agent;
}

// axios can't use an undici dispatcher, but Node's http(s) agents accept the
// same `lookup` hook, so axios requests (providers that need form-data /
// stream uploads) get the identical pinned-DNS guard as `this.fetch`.
// `proxy: false` because with HTTP(S)_PROXY set axios would connect to the
// proxy instead, and the target IP would never be checked. The undici
// dispatcher above already ignores those env vars.
const ssrfSafeAxios = axios.create({
  proxy: false,
  httpAgent: withLiteralIpGuard(
    new http.Agent({ lookup: ssrfSafeLookup as LookupFunction } as http.AgentOptions)
  ),
  httpsAgent: withLiteralIpGuard(
    new https.Agent({
      lookup: ssrfSafeLookup as LookupFunction,
    } as https.AgentOptions)
  ),
});

/**
 * Opt-out reservado a instalacoes self-hosted que precisam alcancar providers
 * ou webhooks HTTPS dentro de uma rede privada confiavel.
 */
export function getSsrfSafeDispatcher(): Agent | undefined {
  return isSsrfProtectionDisabled() ? undefined : ssrfSafeDispatcher;
}

export function getSsrfSafeAxios(): AxiosInstance {
  return isSsrfProtectionDisabled() ? axios : ssrfSafeAxios;
}

type UndiciRequestInit = RequestInit & { dispatcher?: Agent };

export function ssrfSafeFetch(
  input: Parameters<typeof fetch>[0],
  init: UndiciRequestInit = {}
): Promise<Response> {
  return fetch(input, {
    ...init,
    dispatcher: init.dispatcher ?? getSsrfSafeDispatcher(),
  } as RequestInit);
}

// For SDKs that take a `fetch` implementation instead of a URL (e.g. the
// Bluesky agent), so every request they make, redirects included, goes
// through the same dispatcher.
export function getSsrfSafeFetch(): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      // @ts-ignore - undici-only option; blocks SSRF to internal IPs
      dispatcher: getSsrfSafeDispatcher(),
    });
}
