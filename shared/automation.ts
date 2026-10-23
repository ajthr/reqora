import type { HttpResponse } from './types.ts';
import type { Collection, Draft, Entry } from './workspace.ts';
import type { AuthenticationUpdate } from './auth.ts';

export const MAX_SCRIPT_LENGTH = 32_768;
export const MAX_CHECKS = 100;
export const MAX_EXECUTIONS = 1000;
export type DataRow = Record<string, unknown>;
export type VariableScope = 'global' | 'collection';
export interface VariableChange { scope: VariableScope; name: string; value?: string }
export type ValueSource = 'status' | 'json' | 'header' | 'body' | 'duration';
export type AssertionOperator = 'equals' | 'notEquals' | 'contains' | 'exists' | 'lessThan' | 'greaterThan';
export interface Assertion { id: string; enabled: boolean; name: string; source: ValueSource; path: string; operator: AssertionOperator; expected: string }
export interface Extraction { id: string; enabled: boolean; name: string; source: ValueSource; path: string; variable: string; scope: VariableScope; required: boolean }
export interface ScriptSettings { preRequestScript: string; postResponseScript: string }
export interface RequestAutomation extends ScriptSettings { assertions: Assertion[]; extractions: Extraction[] }
export interface CheckResult { name: string; passed: boolean; kind: 'script' | 'assertion' | 'extraction'; error?: string; phase?: string }
export interface ScriptLog { level: 'log' | 'warn' | 'error'; message: string; phase: string }
export interface ExecutionInput { request: Draft; globals: Entry[]; collection?: Collection; data?: DataRow; files?: Record<string, string>; iteration?: number }
export interface ExecutionResult { response?: HttpResponse; error?: string; tests: CheckResult[]; logs: ScriptLog[]; changes: VariableChange[]; passed: boolean; authUpdates?: AuthenticationUpdate[] }
export interface RunnerOptions { iterations: number; delayMs: number; stopOnFailure: boolean; data: DataRow[]; requestIds?: string[] }
export interface RunItem {
  requestId: string; name: string; method: string; url: string; iteration: number; dataIndex: number;
  status?: number; durationMs?: number; error?: string; passed: boolean; tests: CheckResult[]; logs: ScriptLog[];
  testCounts?: { passed: number; failed: number }; detailsTruncated?: boolean;
}
export interface RunReport {
  version: 1; collectionId: string; collectionName: string; startedAt: string; durationMs: number;
  planned: number; completed: number; passed: number; failed: number; cancelled: boolean; results: RunItem[]; changes: VariableChange[];
  /** Internal token updates; omit from exported run reports. */
  authUpdates?: AuthenticationUpdate[];
}
export function publicRunReport(report: RunReport): Omit<RunReport, 'authUpdates'> { const { authUpdates: _private, ...output } = report; return output; }
export const emptyAutomation = (): RequestAutomation => ({ preRequestScript: '', postResponseScript: '', assertions: [], extractions: [] });
export const newAssertion = (): Assertion => ({ id: crypto.randomUUID(), enabled: true, name: 'Status is 200', source: 'status', path: '', operator: 'equals', expected: '200' });
export const newExtraction = (): Extraction => ({ id: crypto.randomUUID(), enabled: true, name: 'Extract value', source: 'json', path: '$.token', variable: 'token', scope: 'collection', required: true });
export const variableString = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? '';

export function isScriptSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<ScriptSettings>;
  return ['preRequestScript', 'postResponseScript'].every(key => {
    const script = config[key as keyof ScriptSettings];
    return script === undefined || typeof script === 'string' && script.length <= MAX_SCRIPT_LENGTH;
  });
}
export function isAutomation(value: unknown): boolean {
  if (!isScriptSettings(value)) return false;
  const config = value as Partial<RequestAutomation>;
  const base = (row: Assertion | Extraction) => !!row && typeof row.id === 'string' && typeof row.name === 'string'
    && row.name.length <= 500 && typeof row.enabled === 'boolean' && typeof row.path === 'string'
    && row.path.length <= 1024 && ['status', 'json', 'header', 'body', 'duration'].includes(row.source);
  return (config.assertions === undefined || Array.isArray(config.assertions) && config.assertions.length <= MAX_CHECKS && config.assertions.every(row => base(row)
    && ['equals', 'notEquals', 'contains', 'exists', 'lessThan', 'greaterThan'].includes(row.operator) && typeof row.expected === 'string' && row.expected.length <= 16_384))
    && (config.extractions === undefined || Array.isArray(config.extractions) && config.extractions.length <= MAX_CHECKS && config.extractions.every(row => base(row)
      && typeof row.variable === 'string' && row.variable.length <= 255 && ['global', 'collection'].includes(row.scope) && typeof row.required === 'boolean'));
}
export function applyVariableChanges<T extends { variables: Entry[]; collections: Collection[] }>(workspace: T, changes: VariableChange[], collectionId?: string): T {
  const update = (entries: Entry[], change: VariableChange) => change.value === undefined ? entries.filter(entry => entry.name.trim() !== change.name)
    : [...entries.filter(entry => entry.name.trim() !== change.name), { id: crypto.randomUUID(), enabled: true, name: change.name, value: change.value }];
  let variables = workspace.variables;
  let collections = workspace.collections;
  for (const change of changes) {
    if (change.scope === 'global') variables = update(variables, change);
    else collections = collections.map(collection => collection.id === collectionId ? { ...collection, variables: update(collection.variables, change) } : collection);
  }
  return { ...workspace, variables, collections };
}
export function readPath(value: unknown, path: string): unknown {
  if (path === '' || path === '$') return value;
  let keys: string[];
  if (path.startsWith('/')) {
    if (/~(?![01])/.test(path)) throw new Error('Invalid JSON pointer escape.');
    keys = path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
  } else {
    let remaining = path.replace(/^\$\.?/, '');
    keys = [];
    while (remaining) {
      const token = /^(?:\.?([\w$-]+)|\[(\d+)\])/.exec(remaining);
      if (!token) throw new Error('Use a dot/array path such as $.user.id or a JSON pointer such as /user/id.');
      keys.push(token[1] ?? token[2]); remaining = remaining.slice(token[0].length);
    }
  }
  for (const key of keys) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function responseValue(response: HttpResponse, source: ValueSource, path: string): unknown {
  if (source === 'status') return response.status;
  if (source === 'duration') return response.durationMs;
  if (source === 'header') return response.headers.find(header => header.name.toLowerCase() === path.toLowerCase())?.value;
  if (source === 'body') return response.body;
  if (response.encoding !== 'utf8') throw new Error('Binary responses cannot be parsed as JSON.');
  return readPath(JSON.parse(response.body), path);
}
