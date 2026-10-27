export interface SchemaIssue { path: string; message: string }
export type JsonSchema = boolean | Record<string, unknown>;
const annotation = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples', 'example', 'deprecated', 'readOnly', 'writeOnly', 'discriminator', 'xml', 'externalDocs']);
const supported = new Set(['$ref', 'type', 'nullable', 'required', 'properties', 'items', 'enum', 'const', 'additionalProperties', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minProperties', 'maxProperties', 'allOf', 'anyOf', 'oneOf', 'format', 'multipleOf']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
};
const validDateTime = (value: string): boolean => {
  const match = /^(\d{4}-\d{2}-\d{2})[tT](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  return !!match && validDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && (!match[5] || Number(match[6]) < 24 && Number(match[7]) < 60);
};
const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (object(left) && object(right)) { const keys = Object.keys(left); return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key])); }
  return false;
};
const pointer = (root: unknown, ref: string): unknown => {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) throw new Error(`External schema reference is unsupported: ${ref}`);
  let value = root;
  for (const key of ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Schema reference not found: ${ref}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};
export function inspectJsonSchema(schema: unknown, definitions?: Record<string, unknown>): SchemaIssue[] {
  const root = definitions ? { ...(object(schema) ? schema : {}), components: { schemas: definitions } } : schema;
  const seen = new WeakSet<object>(), issues: SchemaIssue[] = [];
  let visits = 0;
  const issue = (path: string, message: string) => { if (issues.length < 30) issues.push({ path, message }); };
  const walk = (value: unknown, path: string, depth: number) => {
    if (issues.length === 30) return;
    if (++visits > 10000 || depth > 40) { issue(path, 'Schema definition exceeded its complexity limit.'); return; }
    if (typeof value === 'boolean') return;
    if (!object(value)) { issue(path, 'Schema must be an object or boolean.'); return; }
    if (seen.has(value)) return;
    seen.add(value);
    for (const key of Object.keys(value)) if (!supported.has(key) && !annotation.has(key) && !['$defs', 'definitions'].includes(key)) issue(path, `Unsupported schema keyword: ${key}.`);
    if (value.type !== undefined) {
      const types = Array.isArray(value.type) ? value.type : [value.type];
      if (!types.length || types.some(type => !['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'].includes(type as string))) issue(path, 'Schema type must be a JSON type or a non-empty array of JSON types.');
    }
    for (const key of ['nullable']) if (value[key] !== undefined && typeof value[key] !== 'boolean') issue(path, `${key} must be boolean.`);
    if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some(key => typeof key !== 'string') || new Set(value.required).size !== value.required.length)) issue(path, 'required must be an array of unique property names.');
    if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length)) issue(path, 'enum must be a non-empty array.');
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) if (value[key] !== undefined && (!Number.isInteger(value[key]) || (value[key] as number) < 0)) issue(path, `${key} must be a non-negative integer.`);
    for (const key of ['minimum', 'maximum', 'multipleOf']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || key === 'multipleOf' && value[key] <= 0)) issue(path, `${key} must be a finite${key === 'multipleOf' ? ' positive' : ''} number.`);
    for (const key of ['exclusiveMinimum', 'exclusiveMaximum']) if (value[key] !== undefined && typeof value[key] !== 'boolean' && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) issue(path, `${key} must be a number or an OpenAPI boolean bound.`);
    if (value.format !== undefined && typeof value.format !== 'string') issue(path, 'format must be a string.');
    if (value.$ref !== undefined) {
      if (typeof value.$ref !== 'string') issue(path, '$ref must be a local reference string.');
      else try { walk(pointer(root, value.$ref), `${path}/$ref`, depth + 1); } catch (error) { issue(path, (error as Error).message); }
    }
    for (const key of ['properties', '$defs', 'definitions']) if (value[key] !== undefined) {
      if (!object(value[key])) issue(path, `${key} must be an object of schemas.`);
      else for (const [name, child] of Object.entries(value[key])) walk(child, `${path}/${key}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
    }
    for (const key of ['items', 'additionalProperties']) if (value[key] !== undefined) walk(value[key], `${path}/${key}`, depth + 1);
    for (const key of ['allOf', 'anyOf', 'oneOf']) if (value[key] !== undefined) {
      if (!Array.isArray(value[key]) || !value[key].length) issue(path, `${key} must be a non-empty array of schemas.`);
      else value[key].forEach((child, index) => walk(child, `${path}/${key}/${index}`, depth + 1));
    }
  };
  walk(schema, '$schema', 0);
  return issues;
}
export function validateJsonSchema(value: unknown, schema: unknown, definitions?: Record<string, unknown>): SchemaIssue[] {
  const configuration = inspectJsonSchema(schema, definitions);
  if (configuration.length) return configuration;
  const root = definitions ? { ...(object(schema) ? schema : {}), components: { schemas: definitions } } : schema;
  let visits = 0;
  const check = (data: unknown, current: unknown, path: string, depth: number): SchemaIssue[] => {
    if (++visits > 10000 || depth > 40) return [{ path, message: 'Schema validation exceeded its complexity limit.' }];
    if (current === true) return [];
    if (current === false) return [{ path, message: 'Value is not allowed.' }];
    if (!object(current)) return [{ path, message: 'Schema must be an object or boolean.' }];
    const unknown = Object.keys(current).filter(key => !supported.has(key) && !annotation.has(key) && key !== '$defs' && key !== 'definitions');
    if (unknown.length) return [{ path, message: `Unsupported schema keyword: ${unknown[0]}.` }];
    const issues: SchemaIssue[] = [];
    if (typeof current.$ref === 'string') {
      try { issues.push(...check(data, pointer(root, current.$ref), path, depth + 1)); }
      catch (error) { return [{ path, message: (error as Error).message }]; }
    }
    const types = typeof current.type === 'string' ? [current.type] : Array.isArray(current.type) ? current.type : [];
    const matches = (type: string) => type === 'null' ? data === null : type === 'array' ? Array.isArray(data) : type === 'object' ? object(data) : type === 'integer' ? typeof data === 'number' && Number.isInteger(data) : type === 'number' ? typeof data === 'number' && Number.isFinite(data) : typeof data === type;
    if (types.length && !types.some(type => typeof type === 'string' && matches(type)) && !(data === null && current.nullable === true)) return [{ path, message: `Expected ${types.join(' or ')}.` }];
    if (current.enum !== undefined && (!Array.isArray(current.enum) || !current.enum.some(item => equal(item, data)))) issues.push({ path, message: 'Value is not in enum.' });
    if (Object.hasOwn(current, 'const') && !equal(current.const, data)) issues.push({ path, message: 'Value does not match const.' });
    if (Array.isArray(current.allOf)) for (const part of current.allOf) { if (issues.length >= 30) break; issues.push(...check(data, part, path, depth + 1)); }
    if (Array.isArray(current.anyOf) && !current.anyOf.some(part => !check(data, part, path, depth + 1).length)) issues.push({ path, message: 'Value does not match anyOf.' });
    if (Array.isArray(current.oneOf) && current.oneOf.filter(part => !check(data, part, path, depth + 1).length).length !== 1) issues.push({ path, message: 'Value must match exactly one oneOf branch.' });
    if (typeof data === 'string') {
      if (typeof current.format === 'string') {
        const format = current.format;
        const valid = format === 'uuid' ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data)
          : format === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)
          : format === 'uri' ? (() => { try { return !!new URL(data).protocol; } catch { return false; } })()
          : format === 'date' ? validDate(data)
          : format === 'date-time' ? validDateTime(data)
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
      if (current.items !== undefined) for (let index = 0; index < data.length && issues.length < 30; index++) issues.push(...check(data[index], current.items, `${path}/${index}`, depth + 1));
    }
    if (object(data)) {
      const properties = object(current.properties) ? current.properties : {};
      if (typeof current.minProperties === 'number' && Object.keys(data).length < current.minProperties) issues.push({ path, message: `Expected at least ${current.minProperties} properties.` });
      if (typeof current.maxProperties === 'number' && Object.keys(data).length > current.maxProperties) issues.push({ path, message: `Expected at most ${current.maxProperties} properties.` });
      if (Array.isArray(current.required)) for (const key of current.required) if (typeof key === 'string' && !Object.hasOwn(data, key)) issues.push({ path: `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, message: 'Required property is missing.' });
      for (const [key, item] of Object.entries(data)) {
        if (issues.length >= 30) break;
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
export interface SchemaSettings { enabled: boolean; manualResponse: string; manualRequest?: string; requestSchema?: unknown; requestRequired?: boolean; responses?: OpenApiResponseSchema[] }
export type { MockSettings } from './mocks.ts';
export { isMockSettings } from './mocks.ts';
export function isSchemaSettings(value: unknown): value is SchemaSettings {
  if (!object(value)) return false;
  return typeof value.enabled === 'boolean' && typeof value.manualResponse === 'string' && value.manualResponse.length <= 100_000
    && (value.manualRequest === undefined || typeof value.manualRequest === 'string' && value.manualRequest.length <= 100_000)
    && (value.requestRequired === undefined || typeof value.requestRequired === 'boolean')
    && (value.responses === undefined || Array.isArray(value.responses) && value.responses.length <= 100 && value.responses.every(item => object(item) && typeof item.status === 'string' && typeof item.mediaType === 'string'))
    && JSON.stringify(value).length <= 600_000;
}
export function matchingResponseSchema(responses: OpenApiResponseSchema[], status: number, contentType: string): OpenApiResponseSchema | undefined {
  const code = String(status), media = contentType.split(';')[0].trim().toLowerCase();
  const selectedStatus = responses.some(item => item.status === code) ? code : responses.some(item => item.status.toUpperCase() === `${code[0]}XX`) ? `${code[0]}XX` : 'default';
  const candidates = responses.filter(item => item.status.toUpperCase() === selectedStatus.toUpperCase());
  return candidates.find(item => item.mediaType.toLowerCase() === media && !!media)
    || candidates.find(item => item.mediaType === '*/*' || item.mediaType.endsWith('/*') && media.startsWith(item.mediaType.slice(0, -1).toLowerCase()))
    || candidates.find(item => !item.mediaType);
}
