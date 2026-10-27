import { base64ByteLength } from './body.ts';
import type { ResponseExample } from './workspace.ts';

export interface MockResponse {
  status: number; statusText: string; headers: { name: string; value: string }[]; body: string;
  encoding?: 'utf8' | 'base64'; delayMs?: number; failure?: 'none' | 'network' | 'timeout';
}
export interface MockScenario extends MockResponse { id: string; name: string }
export interface MockSettings extends MockResponse { enabled: boolean; scenarios?: MockScenario[]; activeScenarioId?: string }

export function defaultMock(): MockSettings {
  return { enabled: false, status: 200, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{}' };
}
export function selectedMock(mock: MockSettings): MockResponse {
  return mock.scenarios?.find(item => item.id === mock.activeScenarioId) || mock;
}
export function mockResponseError(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Provide a mock response.';
  const mock = value as MockResponse;
  if (mock.delayMs !== undefined && (!Number.isInteger(mock.delayMs) || mock.delayMs < 0 || mock.delayMs > 60_000)) return 'Mock delay must be an integer from 0 to 60,000 ms.';
  if (mock.failure !== undefined && !['none', 'network', 'timeout'].includes(mock.failure)) return 'Choose a supported mock failure mode.';
  if (mock.failure === 'network' || mock.failure === 'timeout') return '';
  if (!Number.isInteger(mock.status) || mock.status < 100 || mock.status > 599) return 'Mock status must be an integer from 100 to 599.';
  if (typeof mock.statusText !== 'string' || mock.statusText.length > 200 || /[\r\n\0]/.test(mock.statusText)) return 'Mock status text must be at most 200 characters without line breaks.';
  if (typeof mock.body !== 'string' || mock.body.length > 100_000) return 'Mock bodies are limited to 100,000 characters.';
  if (mock.encoding !== undefined && !['utf8', 'base64'].includes(mock.encoding)) return 'Choose text or base64 encoding.';
  if (mock.encoding === 'base64' && base64ByteLength(mock.body) === null) return 'Binary mock bodies must contain canonical base64.';
  if (!Array.isArray(mock.headers) || mock.headers.length > 30 || mock.headers.some(header => !header || typeof header.name !== 'string' || header.name.length > 255 || !/^[!#$%&'*+.^_`|~\w-]+$/.test(header.name) || typeof header.value !== 'string' || header.value.length > 8192 || /[\r\n\0]/.test(header.value))) return 'Use up to 30 named HTTP headers without line breaks in their values.';
  return '';
}
export function isMockSettings(value: unknown): value is MockSettings {
  const shape = (value: unknown): value is MockResponse => {
    if (!value || typeof value !== 'object') return false;
    const response = value as MockResponse;
    return Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      && typeof response.statusText === 'string' && response.statusText.length <= 200 && typeof response.body === 'string' && response.body.length <= 100_000
      && (response.encoding === undefined || ['utf8', 'base64'].includes(response.encoding))
      && (response.delayMs === undefined || Number.isInteger(response.delayMs) && response.delayMs >= 0 && response.delayMs <= 60_000)
      && (response.failure === undefined || ['none', 'network', 'timeout'].includes(response.failure))
      && Array.isArray(response.headers) && response.headers.length <= 30 && response.headers.every(header => header && typeof header.name === 'string' && header.name.length <= 255 && typeof header.value === 'string' && header.value.length <= 8192);
  };
  if (!shape(value)) return false;
  const mock = value as MockSettings;
  if (typeof mock.enabled !== 'boolean') return false;
  if (mock.scenarios !== undefined && (!Array.isArray(mock.scenarios) || mock.scenarios.length > 20 || mock.scenarios.some(item => !shape(item) || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) || new Set(mock.scenarios.map(item => item.id)).size !== mock.scenarios.length)) return false;
  if (mock.activeScenarioId !== undefined && (typeof mock.activeScenarioId !== 'string' || !mock.scenarios?.some(item => item.id === mock.activeScenarioId))) return false;
  return JSON.stringify(mock).length <= 2_200_000;
}
export function mockFromExample(example: ResponseExample): MockResponse {
  if (example.truncated) throw new Error('This example was truncated. Save a complete response before using it as a mock.');
  const headers = example.headers.filter(header => !['content-length', 'transfer-encoding', 'content-encoding', 'connection'].includes(header.name.toLowerCase()));
  const mock: MockResponse = { status: example.status, statusText: example.statusText, headers, body: example.body, encoding: example.encoding, delayMs: 0, failure: 'none' };
  const error = mockResponseError(mock);
  if (error) throw new Error(error);
  return structuredClone(mock);
}
