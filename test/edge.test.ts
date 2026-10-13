import { describe, expect, it } from 'vitest';
import { classify, type RawEntry } from '../src/server/classify';
import { ConfigError, loadConfig } from '../src/server/config';
import { isPublicAddress } from '../src/server/ip';
import { Pipeline } from '../src/server/pipeline';
import { Masker } from '../src/server/privacy';
import { entry } from './helpers';

const answer = (...records: [string, string][]) => records.map(([type, value]) => ({ type, value, ttl: 60 }));

describe('classification: edge cases (F6, F8)', () => {
  it('draws an AAAA-only answer', () => {
    const e: RawEntry = { answer: answer(['AAAA', '2606:4700:4700::1111']) };
    expect(classify(e)).toEqual({ cls: 'allowed', address: '2606:4700:4700::1111' });
  });

  it('takes the first public address even when private ones come before and after it', () => {
    const e: RawEntry = {
      answer: answer(['A', '10.0.0.1'], ['AAAA', 'fd00::1'], ['A', '8.8.4.4'], ['A', '1.1.1.1'], ['A', '192.168.0.1']),
    };
    expect(classify(e)).toEqual({ cls: 'allowed', address: '8.8.4.4' });
  });

  it('treats an answer made only of private IPv6 / mapped private addresses as local', () => {
    expect(classify({ answer: answer(['AAAA', 'fd12:3456::1']) }).cls).toBe('local');
    expect(classify({ answer: answer(['AAAA', 'fe80::1']) }).cls).toBe('local');
    expect(classify({ answer: answer(['AAAA', '::ffff:10.1.2.3']) }).cls).toBe('local');
    expect(classify({ answer: answer(['A', '127.0.0.1']) }).cls).toBe('local');
  });

  it('has no destination for a CNAME-only answer: nothing was resolved', () => {
    expect(classify({ answer: answer(['CNAME', 'edge.cdn.example.net.']), reason: 'NotFilteredNotFound' }).cls).toBe('noanswer');
  });

  it('treats null and empty answers as no answer, whatever the status', () => {
    expect(classify({ answer: null, status: 'NXDOMAIN' }).cls).toBe('noanswer');
    expect(classify({ answer: [], status: 'NOERROR' }).cls).toBe('noanswer');
    expect(classify({ answer: [], status: 'SERVFAIL' }).cls).toBe('noanswer');
  });

  it('ignores records that are not addresses, even in an A record', () => {
    const e: RawEntry = {
      answer: [
        { type: 'A', value: 'not-an-ip' },
        { type: 'A', value: 12345 },
        { type: 'A', value: null },
        { type: 'TXT', value: '8.8.8.8' },
        { type: 'A' },
      ],
    };
    expect(classify(e)).toEqual({ cls: 'noanswer' });
  });

  it('lets Filtered* win over a public answer, and NotFiltered* does not count as blocked', () => {
    expect(classify({ reason: 'FilteredParental', answer: answer(['A', '8.8.8.8']) }).cls).toBe('blocked');
    expect(classify({ reason: 'NotFilteredWhiteList', answer: answer(['A', '8.8.8.8']) }).cls).toBe('allowed');
  });

  it('keeps a rewrite to a public address drawable and a rewrite without addresses local', () => {
    expect(classify({ reason: 'Rewrite', answer: answer(['A', '203.0.114.9']) }).cls).toBe('allowed');
    expect(classify({ reason: 'RewriteEtcHosts', answer: answer(['A', '192.168.1.5']) }).cls).toBe('local');
    expect(classify({ reason: 'Rewrite', answer: null }).cls).toBe('local');
  });
});

describe('public address detection: range boundaries', () => {
  it.each([
    '172.15.255.255',
    '172.32.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '192.0.1.1',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255',
    '2000::1',
    '2001:db9::1',
    '2a00:1450:4001:81b::200e',
    '::ffff:8.8.8.8',
  ])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '172.16.0.0',
    '100.64.0.0',
    '100.127.255.255',
    '198.18.0.1',
    '198.19.255.255',
    '192.0.2.7',
    '198.51.100.7',
    '203.0.113.7',
    '240.0.0.1',
    '1fff::1',
    '2001:db8:ffff::1',
    '64:ff9b::1',
    '::ffff:127.0.0.1',
    '',
    '1.2.3',
    '1.2.3.4.5',
    '999.1.1.1',
  ])('%s is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('pipeline: robustness and privacy', () => {
  it('skips entries it cannot place in time or name, and never throws on odd shapes', () => {
    const odd: RawEntry[] = [
      { ...entry(1), question: null },
      { ...entry(2), question: { name: '' } },
      { ...entry(3), time: 'not a time' },
      { ...entry(4), time: undefined },
      { ...entry(5), answer: null, client_info: null },
      entry(6),
    ];
    const events = new Pipeline().process('x', odd);
    expect(events.map((e) => e.domain)).toEqual(['host-5.example.com', 'host-6.example.com']);
  });

  it('names a device by its IP, then "unknown", when AdGuard Home has no name', () => {
    const [a, b] = new Pipeline().process('x', [
      entry(1, { client_info: { name: '  ' } }),
      entry(2, { client: undefined, client_info: undefined }),
    ]);
    expect(a!.client).toBe('192.168.1.20');
    expect(b!.client).toBe('unknown');
  });

  it('applies IGNORE_* to the real names even when masking is on', () => {
    const events = new Pipeline({
      masker: new Masker(),
      ignoreClients: ['tv'],
      ignoreDomains: ['noisy.example'],
    }).process('x', [
      entry(1),
      entry(2, { client_info: { name: 'phone' }, question: { name: 'a.noisy.example', type: 'A' } }),
      entry(3, { client_info: { name: 'phone' } }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.client).toBe('Device 01');
  });

  it('does not treat a domain that merely ends in the ignored text as a subdomain', () => {
    const events = new Pipeline({ ignoreDomains: ['example.org'] }).process('x', [
      entry(1, { question: { name: 'notexample.org', type: 'A' } }),
      entry(2, { question: { name: 'www.example.org', type: 'A' } }),
    ]);
    expect(events.map((e) => e.domain)).toEqual(['notexample.org']);
  });

  it('masks consistently: same input, same token; different input, different token', () => {
    const masker = new Masker();
    expect(masker.domain('a.example')).toBe(masker.domain('a.example'));
    expect(masker.domain('a.example')).not.toBe(masker.domain('b.example'));
    expect(masker.device('tv')).toBe('Device 01');
    expect(masker.device('phone')).toBe('Device 02');
    expect(masker.device('tv')).toBe('Device 01');
  });

  it('keys the domain token per process, so it cannot be reversed from a dictionary', () => {
    const one = new Masker().domain('netflix.com');
    const two = new Masker().domain('netflix.com');
    expect(one).not.toBe(two);
    expect(one).not.toContain('netflix');
    expect(one).toMatch(/^~[0-9a-f]{12}$/);
  });

  it('keeps location and class when masked: only names change', () => {
    const geo = { lookup: () => ({ lat: 1, lon: 2, city: 'X', country: 'Y', cc: 'ZZ' }) };
    const [plain] = new Pipeline({ geo }).process('x', [entry(1)]);
    const [masked] = new Pipeline({ geo, masker: new Masker() }).process('x', [entry(1)]);
    expect({ ...masked, client: 0, domain: 0 }).toEqual({ ...plain, client: 0, domain: 0 });
  });

  it('gives every event of an instance a unique id', () => {
    const p = new Pipeline();
    const ids = [...p.process('a', [entry(1), entry(2)]), ...p.process('b', [entry(3)])].map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('configuration: further errors and normalisation (section 6)', () => {
  const base = {
    ADGUARD_1_URL: 'http://agh.lan:3000',
    ADGUARD_1_USER: 'atlas',
    ADGUARD_1_PASSWORD: 'pw',
    HOME_LAT: '52.2',
    HOME_LON: '21.0',
  };
  const noFile = () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };

  it.each([
    [{ ...base, ADGUARD_1_URL: 'not a url' }, /ADGUARD_1_URL is not a valid URL/],
    [{ ...base, ADGUARD_1_USER: undefined }, /ADGUARD_1_USER is required/],
    [{ ...base, ADGUARD_1_INSECURE_TLS: 'sometimes' }, /ADGUARD_1_INSECURE_TLS must be true or false/],
    [{ ...base, PORT: '0' }, /PORT must be a whole number between 1 and 65535/],
    [{ ...base, PORT: '70000' }, /PORT must be a whole number/],
    [{ ...base, PORT: '80.5' }, /PORT must be a whole number/],
    [{ ...base, POLL_INTERVAL_MS: '100' }, /POLL_INTERVAL_MS must be a whole number between 250/],
    [{ ...base, WINDOW_MINUTES: '0' }, /WINDOW_MINUTES must be a whole number between 1/],
    [{ ...base, WINDOW_MINUTES: '241' }, /WINDOW_MINUTES/],
    [{ ...base, HOME_LON: '181' }, /HOME_LON must be a number between -180 and 180/],
    [{ ...base, HOME_LON: 'east' }, /HOME_LON must be a number/],
    [{ ...base, LOG_LEVEL: 'chatty' }, /LOG_LEVEL must be one of/],
    [{ ...base, ADGUARD_3_USER: 'u', ADGUARD_3_PASSWORD: 'p' }, /ADGUARD_3_URL is required/],
  ])('rejects bad input with a message that names the variable (%#)', (env, message) => {
    expect(() => loadConfig(env, noFile)).toThrow(ConfigError);
    expect(() => loadConfig(env, noFile)).toThrow(message);
  });

  it('treats an empty HOME_LAT like a missing one', () => {
    expect(() => loadConfig({ ...base, HOME_LAT: '' }, noFile)).toThrow(/HOME_LAT and HOME_LON are required/);
  });

  it('accepts the poles, the antimeridian and the equator', () => {
    for (const [lat, lon] of [['90', '180'], ['-90', '-180'], ['0', '0']]) {
      expect(loadConfig({ ...base, HOME_LAT: lat, HOME_LON: lon }, noFile).home).toEqual({ lat: Number(lat), lon: Number(lon), label: 'Home' });
    }
  });

  it('makes display names unique, because the UI filters by them', () => {
    const c = loadConfig(
      {
        ...base,
        ADGUARD_2_URL: 'http://agh.lan:3001',
        ADGUARD_2_USER: 'u',
        ADGUARD_2_PASSWORD: 'p',
        ADGUARD_3_URL: 'http://other.lan',
        ADGUARD_3_USER: 'u',
        ADGUARD_3_PASSWORD: 'p',
        ADGUARD_3_NAME: 'agh.lan',
      },
      noFile,
    );
    expect(c.instances.map((i) => i.name)).toEqual(['agh.lan', 'agh.lan #2', 'agh.lan #3']);
  });

  it('prefers the variable over the *_FILE variant, and strips only the final newline', () => {
    const read = () => 'from-file \r\n';
    const { ADGUARD_1_PASSWORD: _drop, ...rest } = base;
    expect(loadConfig({ ...rest, ADGUARD_1_PASSWORD_FILE: '/x' }, read).instances[0]!.password).toBe('from-file ');
    expect(loadConfig({ ...base, ADGUARD_1_PASSWORD_FILE: '/x' }, read).instances[0]!.password).toBe('pw');
    expect(loadConfig({ ...rest, ADGUARD_1_PASSWORD: '', ADGUARD_1_PASSWORD_FILE: '/x' }, read).instances[0]!.password).toBe('from-file ');
  });

  it('drops a query string or trailing slashes from the URL, and keeps a base path', () => {
    const url = (u: string) => loadConfig({ ...base, ADGUARD_1_URL: u }, noFile).instances[0]!.url;
    expect(url('http://agh.lan:3000///')).toBe('http://agh.lan:3000');
    expect(url('http://agh.lan/adguard/?x=1#y')).toBe('http://agh.lan/adguard');
  });

  it('does not look at ADGUARD_* in demo mode, so nothing can be contacted by mistake', () => {
    const c = loadConfig({ DEMO: 'true', ADGUARD_1_URL: 'ftp://nonsense', PRIVACY_MODE: 'true' }, noFile);
    expect(c.instances).toEqual([]);
    expect(c.privacyMode).toBe(true);
  });
});
