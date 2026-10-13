import { describe, expect, it } from 'vitest';
import { classify, clientName, parseTimeNs, questionName } from '../src/server/classify';
import { isPublicAddress } from '../src/server/ip';
import { Pipeline } from '../src/server/pipeline';
import { Masker } from '../src/server/privacy';
import { fixture } from './helpers';

const byName = () => new Map(fixture().data.map((e) => [e.question!.name!, e]));

describe('classification of query-log entries (F6, F8)', () => {
  it('follows a CNAME chain to the first public address', () => {
    expect(classify(byName().get('video.example.com')!)).toEqual({ cls: 'allowed', address: '93.184.216.34' });
  });

  it('skips private addresses and takes the first public one', () => {
    expect(classify(byName().get('IPv6.Example.ORG.')!)).toEqual({
      cls: 'allowed',
      address: '2606:2800:220:1:248:1893:25c8:1946',
    });
  });

  it('treats every Filtered* reason as blocked, whatever the answer', () => {
    expect(classify(byName().get('ads.tracker.example')!).cls).toBe('blocked');
    expect(classify(byName().get('safe.example.org')!).cls).toBe('blocked');
  });

  it('treats private answers and rewrites to the LAN as local', () => {
    expect(classify(byName().get('nas.home')!).cls).toBe('local');
    expect(classify({ reason: 'RewriteRule', answer: [] }).cls).toBe('local');
  });

  it('draws a rewrite that points at a public address', () => {
    expect(classify(byName().get('vpn.example.org')!)).toEqual({ cls: 'allowed', address: '203.0.114.9' });
  });

  it('treats NXDOMAIN, SERVFAIL and empty answers as no answer', () => {
    expect(classify(byName().get('wpad.localdomain')!).cls).toBe('noanswer');
    expect(classify(byName().get('broken.example.org')!).cls).toBe('noanswer');
    expect(classify({}).cls).toBe('noanswer');
  });

  it('uses the client name AdGuard Home knows, the IP otherwise (D5)', () => {
    expect(clientName(byName().get('video.example.com')!)).toBe('tv');
    expect(clientName(byName().get('ads.tracker.example')!)).toBe('192.168.1.31');
  });

  it('normalises question names', () => {
    expect(questionName(byName().get('IPv6.Example.ORG.')!)).toBe('ipv6.example.org');
  });
});

describe('public address detection', () => {
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:1.1.1.1'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.251',
    '255.255.255.255',
    '::',
    '::1',
    'fd00::1',
    'fe80::1',
    'ff02::fb',
    '2001:db8::1',
    '::ffff:192.168.1.1',
    'not-an-address',
  ])('%s is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('timestamps', () => {
  it('keeps nanosecond precision and honours the offset', () => {
    const a = parseTimeNs('2026-10-13T12:00:00.123456789+02:00')!;
    const b = parseTimeNs('2026-10-13T10:00:00.123456790Z')!;
    expect(b - a).toBe(1n);
    expect(Number(a / 1_000_000n)).toBe(Date.parse('2026-10-13T10:00:00.123Z'));
  });

  it('rejects anything else', () => {
    expect(parseTimeNs('yesterday')).toBeNull();
    expect(parseTimeNs(undefined)).toBeNull();
  });
});

describe('pipeline', () => {
  const geo = {
    lookup: (ip: string) => (ip === '93.184.216.34' ? { lat: 42.15, lon: -70.82, city: 'Norwell', country: 'United States', cc: 'US' } : undefined),
  };

  it('turns the recorded log into located, classified events', () => {
    const events = new Pipeline({ geo }).process('ghost', fixture().data);
    expect(events).toHaveLength(8);
    const video = events.find((e) => e.domain === 'video.example.com')!;
    expect(video).toMatchObject({
      instance: 'ghost',
      client: 'tv',
      cls: 'allowed',
      qtype: 'A',
      t: Date.parse('2026-10-13T10:00:07.000Z'),
      dest: { city: 'Norwell', cc: 'US' },
    });
    // An address the database does not know is still counted, just not drawn.
    const vpn = events.find((e) => e.domain === 'vpn.example.org')!;
    expect(vpn.cls).toBe('allowed');
    expect(vpn.dest).toBeUndefined();
    expect(events.filter((e) => e.cls === 'blocked')).toHaveLength(2);
    expect(new Set(events.map((e) => e.id)).size).toBe(8);
    // Addresses never leave the server.
    expect(JSON.stringify(events)).not.toContain('93.184.216.34');
  });

  it('honours IGNORE_CLIENTS (name or IP) and IGNORE_DOMAINS (with subdomains)', () => {
    const events = new Pipeline({
      geo,
      ignoreClients: ['tv', '192.168.1.31'],
      ignoreDomains: ['example.org'],
    }).process('ghost', fixture().data);
    expect(events.map((e) => e.domain)).toEqual(['wpad.localdomain']);
  });

  it('replaces names before anything is stored when privacy is forced', () => {
    const events = new Pipeline({ geo, masker: new Masker() }).process('ghost', fixture().data);
    const text = JSON.stringify(events);
    for (const secret of ['example', 'tv', 'phone', '192.168', 'localdomain']) expect(text).not.toContain(secret);
    const tv = events.filter((e) => e.client === events[0]!.client);
    expect(tv).toHaveLength(2);
    expect(events[0]!.client).toMatch(/^Device \d\d$/);
    expect(events[0]!.domain).toMatch(/^~[0-9a-f]{12}$/);
  });
});
