import { BlockList, isIP } from 'node:net';

/** IPv4 ranges that are not publicly routable (RFC 6890 and friends). */
const SPECIAL_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const specialV4 = new BlockList();
for (const [net, prefix] of SPECIAL_V4) specialV4.addSubnet(net, prefix, 'ipv4');

/** Global unicast IPv6 is 2000::/3; everything else is local, multicast or reserved. */
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
specialV6.addSubnet('2001:db8::', 32, 'ipv6');

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isIpAddress(value: unknown): value is string {
  return typeof value === 'string' && isIP(value) !== 0;
}

/** True for an address that can exist on the public internet. */
export function isPublicAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) return !specialV4.check(value, 'ipv4');
  if (family === 6) {
    const mapped = MAPPED_V4.exec(value);
    if (mapped) return isPublicAddress(mapped[1]!);
    return globalV6.check(value, 'ipv6') && !specialV6.check(value, 'ipv6');
  }
  return false;
}
