import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/server/config';

const base = {
  ADGUARD_1_URL: 'https://adguard.lan:3000/',
  ADGUARD_1_USER: 'atlas',
  ADGUARD_1_PASSWORD: 'pw',
  HOME_LAT: '52.2',
  HOME_LON: '21.0',
};

const noFile = () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};

describe('configuration (section 6)', () => {
  it('applies the documented defaults', () => {
    const c = loadConfig(base, noFile);
    expect(c).toMatchObject({
      demo: false,
      port: 8080,
      pollIntervalMs: 2000,
      windowMinutes: 15,
      privacyMode: false,
      ignoreClients: [],
      ignoreDomains: [],
      home: { lat: 52.2, lon: 21, label: 'Home' },
    });
    expect(c.instances).toEqual([
      { index: 1, name: 'adguard.lan', url: 'https://adguard.lan:3000', user: 'atlas', password: 'pw', insecureTls: false },
    ]);
  });

  it('reads several instances, each with its own TLS setting', () => {
    const c = loadConfig(
      {
        ...base,
        ADGUARD_1_NAME: 'ghost',
        ADGUARD_2_URL: 'https://10.0.0.2',
        ADGUARD_2_USER: 'u2',
        ADGUARD_2_PASSWORD: 'p2',
        ADGUARD_2_INSECURE_TLS: 'true',
        ADGUARD_7_URL: 'http://10.0.0.7/agh',
        ADGUARD_7_USER: 'u7',
        ADGUARD_7_PASSWORD: 'p7',
      },
      noFile,
    );
    expect(c.instances.map((i) => [i.name, i.url, i.insecureTls])).toEqual([
      ['ghost', 'https://adguard.lan:3000', false],
      ['10.0.0.2', 'https://10.0.0.2', true],
      ['10.0.0.7', 'http://10.0.0.7/agh', false],
    ]);
  });

  it('accepts *_PASSWORD_FILE for Docker secrets', () => {
    const { ADGUARD_1_PASSWORD: _unused, ...rest } = base;
    const c = loadConfig({ ...rest, ADGUARD_1_PASSWORD_FILE: '/run/secrets/agh' }, (p) => {
      expect(p).toBe('/run/secrets/agh');
      return 'from-file\n';
    });
    expect(c.instances[0]!.password).toBe('from-file');
  });

  it('parses the lists and switches', () => {
    const c = loadConfig(
      {
        ...base,
        IGNORE_CLIENTS: 'NAS, 192.168.1.9 ,',
        IGNORE_DOMAINS: '*.Example.com, lan.',
        PRIVACY_MODE: 'yes',
        WINDOW_MINUTES: '30',
        POLL_INTERVAL_MS: '5000',
        PORT: '9000',
        HOME_LABEL: 'Flat',
      },
      noFile,
    );
    expect(c.ignoreClients).toEqual(['nas', '192.168.1.9']);
    expect(c.ignoreDomains).toEqual(['example.com', 'lan']);
    expect(c).toMatchObject({ privacyMode: true, windowMinutes: 30, pollIntervalMs: 5000, port: 9000 });
    expect(c.home.label).toBe('Flat');
  });

  it('needs neither AdGuard Home nor a home in demo mode', () => {
    const c = loadConfig({ DEMO: 'true' }, noFile);
    expect(c.demo).toBe(true);
    expect(c.instances).toEqual([]);
  });

  it.each([
    [{ ...base, HOME_LAT: undefined }, /HOME_LAT and HOME_LON are required/],
    [{ ...base, HOME_LAT: '95' }, /HOME_LAT must be a number/],
    [{ HOME_LAT: '1', HOME_LON: '1' }, /No AdGuard Home instance configured/],
    [{ ...base, ADGUARD_1_PASSWORD: undefined }, /ADGUARD_1_PASSWORD \(or ADGUARD_1_PASSWORD_FILE\) is required/],
    [{ ...base, ADGUARD_1_PASSWORD: undefined, ADGUARD_1_PASSWORD_FILE: '/nope' }, /cannot read \/nope \(ENOENT\)/],
    [{ ...base, ADGUARD_2_USER: 'x' }, /ADGUARD_2_URL is required/],
    [{ ...base, ADGUARD_1_URL: 'ftp://x' }, /must start with http/],
    [{ ...base, ADGUARD_1_URL: 'https://u:p@x' }, /must not contain credentials/],
    [{ ...base, POLL_INTERVAL_MS: 'fast' }, /POLL_INTERVAL_MS must be a whole number/],
    [{ ...base, PRIVACY_MODE: 'maybe' }, /PRIVACY_MODE must be true or false/],
  ])('explains what is wrong (%#)', (env, message) => {
    expect(() => loadConfig(env, noFile)).toThrow(ConfigError);
    expect(() => loadConfig(env, noFile)).toThrow(message);
  });

  it('never puts a password into an error message', () => {
    try {
      loadConfig({ ...base, ADGUARD_1_PASSWORD: 'hunter2', HOME_LAT: 'x' }, noFile);
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('hunter2');
    }
  });
});
