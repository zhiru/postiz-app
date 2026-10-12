import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);

  if ([a, b].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // 127.0.0.0/8
    (a === 169 && b === 254) ||      // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||      // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224                         // multicast/reserved
  );
}

export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  return (
    normalized === '::1' ||          // loopback
    normalized === '::' ||           // unspecified
    normalized.startsWith('fe80:') || // link-local
    normalized.startsWith('fc') ||   // unique local fc00::/7
    normalized.startsWith('fd') ||   // unique local fd00::/7
    normalized.startsWith('ff')      // multicast
  );
}

// Self-hosters legitimately point webhooks at an internal host (e.g. an n8n
// instance on the same Docker network). SSRF_ALLOWED_HOSTS is a comma-separated
// list of exact hostnames and/or IPv4 CIDRs that bypass the private-IP block
// below; empty by default so the hosted product stays fully protected.
function parseSsrfAllowlist(): { hosts: Set<string>; cidrs: string[] } {
  const raw = (process.env.SSRF_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const hosts = new Set<string>();
  const cidrs: string[] = [];
  for (const entry of raw) {
    if (entry.includes('/')) {
      cidrs.push(entry);
    } else {
      hosts.add(entry);
    }
  }
  return { hosts, cidrs };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts.reduce((acc, n) => acc * 256 + n, 0);
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  if (net.isIP(ip) !== 4 || net.isIP(range) !== 4 || Number.isNaN(prefix)) {
    return false;
  }
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function isSsrfAllowlisted(ip: string, hostname?: string): boolean {
  const { hosts, cidrs } = parseSsrfAllowlist();
  if (hostname && hosts.has(hostname.toLowerCase())) return true;
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}

export function isBlockedIp(ip: string, hostname?: string): boolean {
  if (isSsrfAllowlisted(ip, hostname)) {
    return false;
  }

  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIPv4(ip);
  }
  if (version === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and check as IPv4
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isBlockedIPv4(mapped[1]);
    }
    return isBlockedIPv6(ip);
  }
  return true;
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (hostname === 'localhost' && !isSsrfAllowlisted(hostname, hostname)) {
    return false;
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return !isBlockedIp(hostname, hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records.length) {
      return false;
    }

    for (const record of records) {
      if (isBlockedIp(record.address, hostname)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}