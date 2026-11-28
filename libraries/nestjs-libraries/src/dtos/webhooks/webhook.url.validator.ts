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

export function isSsrfProtectionDisabled(): boolean {
  return process.env.DISABLE_SSRF_PROTECTION === 'true';
}

export function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
const blockedIPv4Ranges: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // multicast/reserved
];

// BlockList matches an IPv4 rule against the address in any notation,
// including IPv4-mapped IPv6 like ::ffff:7f00:1 (what the URL parser turns
// [::ffff:127.0.0.1] into), so the addresses are never compared as strings.
const blockedIps = new net.BlockList();

for (const [address, prefix] of blockedIPv4Ranges) {
  blockedIps.addSubnet(address, prefix, 'ipv4');

  // the same IPv4 range embedded in NAT64 (64:ff9b::/96) and 6to4 (2002::/16)
  const [a, b, c, d] = address.split('.').map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  blockedIps.addSubnet(`64:ff9b::${high}:${low}`, 96 + prefix, 'ipv6');
  blockedIps.addSubnet(`2002:${high}:${low}::`, 16 + prefix, 'ipv6');
  // and in IPv4-translated form (::ffff:0:0/96, SIIT)
  blockedIps.addSubnet(`::ffff:0:${high}:${low}`, 96 + prefix, 'ipv6');
}

blockedIps.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64 (RFC 8215)

blockedIps.addSubnet('::', 96, 'ipv6'); // unspecified, loopback, IPv4-compatible
blockedIps.addSubnet('fe80::', 10, 'ipv6'); // link-local
blockedIps.addSubnet('fec0::', 10, 'ipv6'); // site-local (deprecated)
blockedIps.addSubnet('fc00::', 7, 'ipv6'); // unique local
blockedIps.addSubnet('ff00::', 8, 'ipv6'); // multicast

export function isBlockedIPv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);

  if ([a, b, c].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8
    (a === 169 && b === 254) || // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // deprecated 6to4 relay anycast
    (a === 198 && b === 51 && c === 100) || // documentation TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // documentation TEST-NET-3
    a >= 224 // multicast/reserved
  );
}

function expandIPv6(ip: string): number[] | undefined {
  let normalized = ip.toLowerCase().split('%')[0];

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = normalized.slice(lastColon + 1);
    if (net.isIP(ipv4) !== 4) {
      return undefined;
    }

    const bytes = ipv4.split('.').map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${(
      (bytes[0] << 8) |
      bytes[1]
    ).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) {
    return undefined;
  }

  const left = halves[0]
    ? halves[0].split(':').map((part) => Number.parseInt(part, 16))
    : [];
  const right = halves[1]
    ? halves[1].split(':').map((part) => Number.parseInt(part, 16))
    : [];
  const missing = 8 - left.length - right.length;

  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    [...left, ...right].some(
      (part) => Number.isNaN(part) || part < 0 || part > 0xffff
    )
  ) {
    return undefined;
  }

  return [...left, ...Array(missing).fill(0), ...right];
}

export function isBlockedIPv6(ip: string): boolean {
  const parts = expandIPv6(ip);
  if (!parts) {
    return true;
  }

  if (blockedIps.check(ip.split('%')[0], 'ipv6')) {
    return true;
  }

  const first = parts[0];
  const isUnspecifiedOrIpv4Compatible = parts
    .slice(0, 6)
    .every((part) => part === 0);
  const isIpv4Mapped =
    parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  const isWellKnownNat64 =
    first === 0x0064 &&
    parts[1] === 0xff9b &&
    parts.slice(2, 6).every((part) => part === 0);
  const isLocalNat64 =
    first === 0x0064 && parts[1] === 0xff9b && parts[2] === 0x0001;

  if (isIpv4Mapped) {
    const mapped = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${
      parts[7] & 0xff
    }`;
    return isBlockedIPv4(mapped);
  }

  return (
    isUnspecifiedOrIpv4Compatible || // ::/96, incluindo :: e ::1
    (first & 0xfe00) === 0xfc00 || // unique-local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // site-local legado fec0::/10
    (first & 0xff00) === 0xff00 || // multicast ff00::/8
    isWellKnownNat64 || // 64:ff9b::/96 pode traduzir para IPv4 privado
    isLocalNat64 || // 64:ff9b:1::/48 e reservado para NAT64 local
    first === 0x2002 || // 6to4 pode encapsular IPv4 privado
    (first === 0x2001 && parts[1] === 0x0000) || // Teredo encapsula IPv4
    (first === 0x2001 && parts[1] === 0x0db8) // documentacao 2001:db8::/32
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
export class IsSafeWebhookUrlConstraint
  implements ValidatorConstraintInterface
{
  async validate(value: unknown, args: ValidationArguments): Promise<boolean> {
    const allowPrivateNetworkOptOut = args.constraints?.[0] === true;
    if (allowPrivateNetworkOptOut && isSsrfProtectionDisabled()) {
      return isHttpsUrl(value);
    }

    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(
  validationOptions?: ValidationOptions,
  settings: { allowPrivateNetworkOptOut?: boolean } = {}
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [settings.allowPrivateNetworkOptOut === true],
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}
