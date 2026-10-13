import { createHmac, randomBytes } from 'node:crypto';

/**
 * PRIVACY_MODE=true. Masking only in the browser would still put every domain and
 * device name on the wire, so when masking is forced the server replaces them
 * before anything is stored or sent: devices become "Device 01", domains become an
 * opaque token keyed with a secret that lives only in this process. The same input
 * always gives the same token, so counting and grouping keep working.
 */
export class Masker {
  private readonly key = randomBytes(32);
  private readonly devices = new Map<string, string>();

  device(name: string): string {
    let alias = this.devices.get(name);
    if (!alias) {
      alias = `Device ${String(this.devices.size + 1).padStart(2, '0')}`;
      this.devices.set(name, alias);
    }
    return alias;
  }

  domain(name: string): string {
    return '~' + createHmac('sha256', this.key).update(name).digest('hex').slice(0, 12);
  }
}
