export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_API_BYTES = 16 * 1024 * 1024;
export const MAX_BODY_FIELDS = 100;

export function isFileName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255
    && !/[\r\n\0/\\]/.test(name) && name !== '.' && name !== '..';
}

export function isMediaType(type: unknown): type is string {
  return typeof type === 'string' && type.length <= 255
    && (type === '' || /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/i.test(type));
}

export function base64ByteLength(data: unknown): number | null {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_BODY_BYTES / 3) * 4 || data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (data.endsWith('==') && (alphabet.indexOf(data.at(-3)!) & 15) !== 0) return null;
  if (!data.endsWith('==') && data.endsWith('=') && (alphabet.indexOf(data.at(-2)!) & 3) !== 0) return null;
  return data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}
