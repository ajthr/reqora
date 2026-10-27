export interface SchemaIssue { path: string; message: string }
export type JsonSchema = boolean | Record<string, unknown>;
const annotation = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples', 'example', 'deprecated', 'readOnly', 'writeOnly', 'discriminator', 'xml', 'externalDocs']);
const supported = new Set(['$ref', 'type', 'nullable', 'required', 'properties', 'items', 'enum', 'const', 'additionalProperties', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minProperties', 'maxProperties', 'allOf', 'anyOf', 'oneOf', 'format', 'multipleOf']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (object(left) && object(right)) { const keys = Object.keys(left); return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key])); }
  return false;
};
const pointer = (root: unknown, ref: string): unknown => {
  if (!ref.startsWith('#/')) throw new Error(`External schema reference is unsupported: ${ref}`);
  let value = root;
  for (const key of ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!object(value) || !Object.hasOwn(value, key)) throw new Error(`Schema reference not found: ${ref}`);
    value = value[key];
  }
  return value;
};
export function validateJsonSchema(value: unknown, schema: unknown, definitions?: Record<string, unknown>): SchemaIssue[] {
  const root = definitions ? { components: { schemas: definitions } } : schema;
  let visits = 0;
  const check = (data: unknown, current: unknown, path: string, depth: number): SchemaIssue[] => {
    if (++visits > 10000 || depth > 40) return [{ path, message: 'Schema validation exceeded its complexity limit.' }];
    if (current === true) return [];
    if (current === false) return [{ path, message: 'Value is not allowed.' }];
    if (!object(current)) return [{ path, message: 'Schema must be an object or boolean.' }];
    const unknown = Object.keys(current).filter(key => !supported.has(key) && !annotation.has(key) && key !== '$defs' && key !== 'definitions');
    if (unknown.length) return [{ path, message: `Unsupported schema keyword: ${unknown[0]}.` }];
    if (typeof current.$ref === 'string') {
      try { return check(data, pointer(root, current.$ref), path, depth + 1); }
      catch (error) { return [{ path, message: (error as Error).message }]; }
    }
    const issues: SchemaIssue[] = [];
    const types = typeof current.type === 'string' ? [current.type] : Array.isArray(current.type) ? current.type : [];
    const matches = (type: string) => type === 'null' ? data === null : type === 'array' ? Array.isArray(data) : type === 'object' ? object(data) : type === 'integer' ? typeof data === 'number' && Number.isInteger(data) : type === 'number' ? typeof data === 'number' && Number.isFinite(data) : typeof data === type;
    if (types.length && !types.some(type => typeof type === 'string' && matches(type)) && !(data === null && current.nullable === true)) return [{ path, message: `Expected ${types.join(' or ')}.` }];
    if (current.enum !== undefined && (!Array.isArray(current.enum) || !current.enum.some(item => equal(item, data)))) issues.push({ path, message: 'Value is not in enum.' });
    if (Object.hasOwn(current, 'const') && !equal(current.const, data)) issues.push({ path, message: 'Value does not match const.' });
    if (Array.isArray(current.allOf)) for (const part of current.allOf) issues.push(...check(data, part, path, depth + 1));
    if (Array.isArray(current.anyOf) && !current.anyOf.some(part => !check(data, part, path, depth + 1).length)) issues.push({ path, message: 'Value does not match anyOf.' });
    if (Array.isArray(current.oneOf) && current.oneOf.filter(part => !check(data, part, path, depth + 1).length).length !== 1) issues.push({ path, message: 'Value must match exactly one oneOf branch.' });
    if (typeof data === 'string') {
      if (typeof current.format === 'string') {
        const format = current.format;
        const valid = format === 'uuid' ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data)
          : format === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)
          : format === 'uri' ? (() => { try { return !!new URL(data).protocol; } catch { return false; } })()
          : format === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(Date.parse(data))
          : format === 'date-time' ? !Number.isNaN(Date.parse(data)) && /T/.test(data)
          : format === 'binary' || format === 'byte' || format === 'password' ? true : undefined;
        if (valid === undefined) issues.push({ path, message: `Unsupported string format: ${format}.` });
        else if (!valid) issues.push({ path, message: `Invalid ${format} format.` });
      }
      if (typeof current.minLength === 'number' && [...data].length < current.minLength) issues.push({ path, message: `Expected at least ${current.minLength} characters.` });
      if (typeof current.maxLength === 'number' && [...data].length > current.maxLength) issues.push({ path, message: `Expected at most ${current.maxLength} characters.` });
    }
    if (typeof data === 'number') {
      if (typeof current.multipleOf === 'number' && current.multipleOf > 0 && Math.abs(data / current.multipleOf - Math.round(data / current.multipleOf)) > 1e-9) issues.push({ path, message: `Expected a multiple of ${current.multipleOf}.` });
      if (typeof current.minimum === 'number' && data < current.minimum) issues.push({ path, message: `Expected >= ${current.minimum}.` });
      if (typeof current.maximum === 'number' && data > current.maximum) issues.push({ path, message: `Expected <= ${current.maximum}.` });
      if (typeof current.exclusiveMinimum === 'number' && data <= current.exclusiveMinimum || current.exclusiveMinimum === true && typeof current.minimum === 'number' && data <= current.minimum) issues.push({ path, message: 'Value is below exclusive minimum.' });
      if (typeof current.exclusiveMaximum === 'number' && data >= current.exclusiveMaximum || current.exclusiveMaximum === true && typeof current.maximum === 'number' && data >= current.maximum) issues.push({ path, message: 'Value is above exclusive maximum.' });
    }
    if (Array.isArray(data)) {
      if (typeof current.minItems === 'number' && data.length < current.minItems) issues.push({ path, message: `Expected at least ${current.minItems} items.` });
      if (typeof current.maxItems === 'number' && data.length > current.maxItems) issues.push({ path, message: `Expected at most ${current.maxItems} items.` });
      if (current.items !== undefined) data.forEach((item, index) => issues.push(...check(item, current.items, `${path}/${index}`, depth + 1)));
    }
    if (object(data)) {
      const properties = object(current.properties) ? current.properties : {};
      if (typeof current.minProperties === 'number' && Object.keys(data).length < current.minProperties) issues.push({ path, message: `Expected at least ${current.minProperties} properties.` });
      if (typeof current.maxProperties === 'number' && Object.keys(data).length > current.maxProperties) issues.push({ path, message: `Expected at most ${current.maxProperties} properties.` });
      if (Array.isArray(current.required)) for (const key of current.required) if (typeof key === 'string' && !Object.hasOwn(data, key)) issues.push({ path: `${path}/${key}`, message: 'Required property is missing.' });
      for (const [key, item] of Object.entries(data)) {
        const itemPath = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (Object.hasOwn(properties, key)) issues.push(...check(item, properties[key], itemPath, depth + 1));
        else if (current.additionalProperties === false) issues.push({ path: itemPath, message: 'Additional property is not allowed.' });
        else if (object(current.additionalProperties) || typeof current.additionalProperties === 'boolean') issues.push(...check(item, current.additionalProperties, itemPath, depth + 1));
      }
    }
    return issues.slice(0, 30);
  };
  return check(value, schema, '$', 0).slice(0, 30);
}
export interface OpenApiResponseSchema { status: string; mediaType: string; schema?: unknown }
export interface SchemaSettings { enabled: boolean; manualResponse: string; requestSchema?: unknown; requestRequired?: boolean; responses?: OpenApiResponseSchema[] }
export interface MockSettings { enabled: boolean; status: number; statusText: string; headers: { name: string; value: string }[]; body: string }
export function isSchemaSettings(value: unknown): value is SchemaSettings {
  if (!object(value)) return false;
  return typeof value.enabled === 'boolean' && typeof value.manualResponse === 'string' && value.manualResponse.length <= 100_000
    && (value.requestRequired === undefined || typeof value.requestRequired === 'boolean')
    && (value.responses === undefined || Array.isArray(value.responses) && value.responses.length <= 100 && value.responses.every(item => object(item) && typeof item.status === 'string' && typeof item.mediaType === 'string'))
    && JSON.stringify(value).length <= 600_000;
}
export function isMockSettings(value: unknown): value is MockSettings {
  if (!object(value)) return false;
  return typeof value.enabled === 'boolean' && Number.isInteger(value.status) && (value.status as number) >= 100 && (value.status as number) <= 599
    && typeof value.statusText === 'string' && value.statusText.length <= 200 && typeof value.body === 'string' && value.body.length <= 100_000
    && Array.isArray(value.headers) && value.headers.length <= 30 && value.headers.every(header => object(header) && typeof header.name === 'string' && header.name.length <= 255 && typeof header.value === 'string' && header.value.length <= 8192);
}
export function matchingResponseSchema(responses: OpenApiResponseSchema[], status: number, contentType: string): OpenApiResponseSchema | undefined {
  const candidates = responses.filter(item => item.status === String(status) || item.status === 'default' || /^\dXX$/.test(item.status) && item.status[0] === String(status)[0]);
  const ranked = candidates.sort((a, b) => Number(b.status === String(status)) - Number(a.status === String(status)));
  return ranked.find(item => !item.mediaType || contentType.toLowerCase().includes(item.mediaType.toLowerCase())) || ranked.find(item => !item.mediaType);
}
