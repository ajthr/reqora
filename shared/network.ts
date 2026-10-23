export interface ProxySettings { mode: 'direct' | 'environment' | 'custom'; url: string; bypass: string }
export interface TlsSettings { caPem: string; clientCertPem: string; clientKeyPem: string; clientKeyPassphrase: string }
export interface NetworkSettings { proxy: ProxySettings; tls: TlsSettings; useCookies: boolean }
export interface CookieRecord {
  id: string; name: string; value: string; domain: string; path: string; hostOnly: boolean;
  secure: boolean; httpOnly: boolean; sameSite: 'none' | 'lax' | 'strict' | ''; expiresAt: number | null; createdAt: number;
}
export const MAX_COOKIES = 300;
export const newNetworkSettings = (): NetworkSettings => ({ proxy: { mode: 'direct', url: '', bypass: '' }, tls: { caPem: '', clientCertPem: '', clientKeyPem: '', clientKeyPassphrase: '' }, useCookies: true });
export const normalizedNetworkSettings = (value?: Partial<NetworkSettings>): NetworkSettings => {
  const defaults = newNetworkSettings();
  return { proxy: { ...defaults.proxy, ...value?.proxy }, tls: { ...defaults.tls, ...value?.tls }, useCookies: value?.useCookies ?? true };
};
export function isNetworkSettings(value: unknown): value is NetworkSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as NetworkSettings;
  if (!settings.proxy || typeof settings.proxy !== 'object' || Array.isArray(settings.proxy) || !['direct', 'environment', 'custom'].includes(settings.proxy.mode)
    || typeof settings.proxy.url !== 'string' || settings.proxy.url.length > 4096 || typeof settings.proxy.bypass !== 'string' || settings.proxy.bypass.length > 4096
    || !settings.tls || typeof settings.tls !== 'object' || Array.isArray(settings.tls) || typeof settings.useCookies !== 'boolean') return false;
  return (['caPem', 'clientCertPem', 'clientKeyPem', 'clientKeyPassphrase'] as const).every(field => typeof settings.tls[field] === 'string' && settings.tls[field].length <= (field === 'caPem' ? 262144 : 65536));
}
export function isCookieRecord(value: unknown): value is CookieRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as CookieRecord;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100
    && typeof item.name === 'string' && /^[!#$%&'*+.^_`|~\w-]{1,256}$/.test(item.name)
    && typeof item.value === 'string' && item.value.length <= 4096 && !/[\x00-\x1f\x7f;]/.test(item.value)
    && typeof item.domain === 'string' && item.domain.length <= 253 && /^[a-z\d.-]+$/i.test(item.domain) && !item.domain.startsWith('.')
    && typeof item.path === 'string' && item.path.startsWith('/') && item.path.length <= 1024 && !/[\r\n\0]/.test(item.path)
    && typeof item.hostOnly === 'boolean' && typeof item.secure === 'boolean' && typeof item.httpOnly === 'boolean'
    && ['', 'none', 'lax', 'strict'].includes(item.sameSite)
    && (item.expiresAt === null || typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) && item.expiresAt >= 0 && item.expiresAt <= 8.64e15)
    && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) && item.createdAt >= 0;
}
export function isCookieJar(value: unknown): value is CookieRecord[] {
  return Array.isArray(value) && value.length <= MAX_COOKIES && value.every(isCookieRecord) && JSON.stringify(value).length <= 1024 * 1024;
}
