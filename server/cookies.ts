import { CookieJar } from 'tough-cookie';
import { isCookieJar, MAX_COOKIES } from '../shared/network.ts';
import type { CookieRecord } from '../shared/network.ts';

export class CookieJarError extends Error {}
const cookieKey = (item: Pick<CookieRecord, 'domain' | 'path' | 'name'>) => `${item.domain.toLowerCase()}\0${item.path}\0${item.name}`;

export class RequestCookieJar {
  private jar = new CookieJar(undefined, { rejectPublicSuffixes: true, prefixSecurity: 'strict', allowSecureOnLocal: false });
  private original: CookieRecord[];

  constructor(records: CookieRecord[] = []) {
    if (!isCookieJar(records)) throw new CookieJarError('The cookie jar is invalid or exceeds its limit.');
    this.original = records;
    for (const item of [...records].sort((a, b) => a.createdAt - b.createdAt)) {
      if (item.expiresAt !== null && item.expiresAt <= Date.now()) continue;
      const hostname = item.domain.toLowerCase();
      let site: URL;
      try { site = new URL(`${item.secure ? 'https' : 'http'}://${hostname}${item.path}`); }
      catch { throw new CookieJarError(`Cookie “${item.name}” has an invalid domain or path.`); }
      if (site.hostname !== hostname) throw new CookieJarError(`Cookie “${item.name}” has an invalid domain.`);
      const text = `${item.name}=${item.value}; Path=${item.path}${item.hostOnly ? '' : `; Domain=${hostname}`}${item.secure ? '; Secure' : ''}${item.httpOnly ? '; HttpOnly' : ''}${item.sameSite ? `; SameSite=${item.sameSite}` : ''}${item.expiresAt === null ? '' : `; Expires=${new Date(item.expiresAt).toUTCString()}`}`;
      try { if (!this.jar.setCookieSync(text, site.href)) throw new Error('rejected'); }
      catch { throw new CookieJarError(`Cookie “${item.name}” was rejected. Check its domain, flags, and value.`); }
    }
  }

  header(url: URL): string { return this.jar.getCookieStringSync(url.href); }

  receive(url: URL, headers: Headers): CookieRecord[] | undefined {
    const received = headers.getSetCookie();
    for (const value of received.slice(0, 100)) {
      if (value.length > 8192) continue;
      try { this.jar.setCookieSync(value, url.href, { ignoreError: true }); }
      catch { /* Malformed upstream cookies are ignored. */ }
    }
    const next = this.snapshot();
    if (JSON.stringify(next) === JSON.stringify(this.original)) return undefined;
    this.original = next;
    return next;
  }

  snapshot(): CookieRecord[] {
    const previous = new Map(this.original.map(item => [cookieKey(item), item]));
    const data = this.jar.serializeSync()?.cookies || [];
    if (data.length > MAX_COOKIES) throw new CookieJarError(`The cookie jar is full (${MAX_COOKIES} cookies). Remove some cookies before continuing.`);
    const result: CookieRecord[] = [];
    for (const entry of data) {
      const domain = String(entry.domain || '').toLowerCase(), name = String(entry.key || ''), path = String(entry.path || '/');
      const old = previous.get(cookieKey({ domain, name, path }));
      const expiry = entry.maxAge !== undefined ? Number(new Date(String(entry.creation || Date.now()))) + Number(entry.maxAge) * 1000
        : entry.expires && entry.expires !== 'Infinity' ? Date.parse(String(entry.expires)) : null;
      if (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now())) continue;
      const record: CookieRecord = { id: old?.id || crypto.randomUUID(), name, value: String(entry.value || ''), domain, path,
        hostOnly: Boolean(entry.hostOnly), secure: Boolean(entry.secure), httpOnly: Boolean(entry.httpOnly), sameSite: ['none', 'lax', 'strict'].includes(String(entry.sameSite).toLowerCase()) ? String(entry.sameSite).toLowerCase() as CookieRecord['sameSite'] : '',
        expiresAt: expiry, createdAt: old?.createdAt || Date.parse(String(entry.creation || '')) || Date.now() };
      if (record.value.length <= 4096) result.push(record);
    }
    if (!isCookieJar(result)) throw new CookieJarError('The cookie jar exceeds the 1 MB limit.');
    return result;
  }
}
