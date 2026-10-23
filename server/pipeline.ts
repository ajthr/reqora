import { executeRequest, RequestError } from './execute.ts';
import { runScript } from './scripts.ts';
import { applyVariableChanges, responseValue, variableString } from '../shared/automation.ts';
import type { Assertion, ExecutionInput, ExecutionResult, VariableChange } from '../shared/automation.ts';
import { validateDataRows } from '../shared/data.ts';
import { getVariableScope, interpolate, isDraft, parseWorkspace, prepareRequest } from '../shared/workspace.ts';
import type { Collection, Draft, Entry } from '../shared/workspace.ts';
import { authConfigurationKey } from '../shared/auth.ts';
import { isCookieJar, normalizedNetworkSettings } from '../shared/network.ts';

export function validateExecutionInput(value: unknown): ExecutionInput {
  if (!value || typeof value !== 'object') throw new RequestError('Provide a request and its variable context.');
  const input = value as ExecutionInput;
  const collection: Collection = input.collection ?? { id: 'scratch', name: 'Scratch', description: '', variables: [] };
  try {
    const normalized = parseWorkspace(JSON.stringify({ version: 1, collections: [collection], saved: [{ collectionId: collection.id, request: input.request }], variables: input.globals, history: [], cookies: input.cookies ?? [] }));
    const variables = [...normalized.variables, ...normalized.collections[0].variables];
    if (variables.length > 1000 || JSON.stringify(variables).length > 1024 * 1024) throw new Error('Variable context exceeds 1 MB or 1000 values.');
    if (input.data !== undefined) validateDataRows([input.data]);
    if (input.iteration !== undefined && (!Number.isInteger(input.iteration) || input.iteration < 0 || input.iteration > 1000)) throw new Error('Invalid iteration index.');
    if (input.files !== undefined && (!input.files || typeof input.files !== 'object' || Array.isArray(input.files) || Object.entries(input.files).some(([key, data]) => key.length > 255 || typeof data !== 'string'))) throw new Error('Invalid attached files.');
    if (input.cookies !== undefined && !isCookieJar(input.cookies)) throw new Error('Invalid cookie jar.');
    return { request: normalized.saved[0].request, globals: normalized.variables, collection: input.collection ? normalized.collections[0] : undefined,
      data: input.data ?? {}, files: input.files ?? {}, iteration: input.iteration ?? 0, cookies: normalized.cookies };
  } catch (error) { throw new RequestError((error as Error).message); }
}

function compare(actual: unknown, expected: unknown, operator: Assertion['operator']): boolean {
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  };
  if (operator === 'exists') return actual !== undefined;
  if (operator === 'equals') return equal(actual, expected);
  if (operator === 'notEquals') return !equal(actual, expected);
  if (operator === 'contains') return typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some(item => equal(item, expected));
  return typeof actual === 'number' && typeof expected === 'number' && (operator === 'lessThan' ? actual < expected : actual > expected);
}

export async function runRequest(value: unknown, signal?: AbortSignal): Promise<ExecutionResult> {
  const input = validateExecutionInput(value);
  let request: Draft = structuredClone(input.request);
  let state = { variables: input.globals, collections: input.collection ? [input.collection] : [] };
  const result: ExecutionResult = { tests: [], logs: [], changes: [], passed: false };
  const rowEntries = Object.entries(input.data || {}).map(([name, value]) => ({ id: `data:${name}`, enabled: true, name, value: variableString(value) }));
  const scope = () => getVariableScope(state.variables, [...(state.collections[0]?.variables || []), ...rowEntries]);
  const commit = (changes: VariableChange[]) => {
    for (const change of changes) {
      if (!['global', 'collection'].includes(change.scope) || typeof change.name !== 'string' || !change.name.trim() || change.name.length > 255
        || (change.value !== undefined && (typeof change.value !== 'string' || change.value.length > 65536))) throw new Error('Invalid script variable change.');
      if (change.scope === 'collection' && !input.collection) throw new Error('This request has no collection variable scope.');
    }
    state = applyVariableChanges(state, changes, input.collection?.id);
    if (JSON.stringify([...state.variables, ...(state.collections[0]?.variables || [])]).length > 1024 * 1024 || state.variables.length + (state.collections[0]?.variables.length || 0) > 1000) throw new Error('Variable context exceeds 1 MB or 1000 values.');
    for (const change of changes) {
      result.changes = result.changes.filter(previous => previous.scope !== change.scope || previous.name !== change.name);
      result.changes.push(change);
    }
  };
  const dictionary = (entries: Entry[]) => Object.fromEntries(getVariableScope(entries).map(entry => [entry.name, entry.value]));
  const script = async (source: string | undefined, phase: string) => {
    if (!source?.trim()) return;
    const output = await runScript({ script: source, phase, request, response: result.response, globals: dictionary(state.variables), collection: dictionary(state.collections[0]?.variables || []), data: input.data || {}, hasCollection: !!input.collection, iteration: input.iteration || 0 }, signal);
    result.tests.push(...output.tests); result.logs.push(...output.logs);
    if (output.error) throw new Error(`${phase}: ${output.error}`);
    if (!isDraft(output.request)) throw new Error(`${phase}: script produced an invalid request.`);
    // Scripts can edit outgoing request fields, but cannot rewrite their own saved checks/scripts.
    request = { ...output.request, preRequestScript: request.preRequestScript, postResponseScript: request.postResponseScript, assertions: request.assertions, extractions: request.extractions };
    commit(output.changes);
  };
  try {
    signal?.throwIfAborted();
    await script(input.collection?.preRequestScript, 'Collection pre-request');
    await script(input.request.preRequestScript, 'Request pre-request');
    const prepared = prepareRequest({ ...request, method: request.method.toUpperCase() }, state.variables, [...(state.collections[0]?.variables || []), ...rowEntries], new Map(Object.entries(input.files || {})), state.collections[0]?.auth);
    if (normalizedNetworkSettings(request.network).useCookies) prepared.cookies = input.cookies;
    const inherited = request.authType === 'inherit' && !!input.collection?.auth;
    result.response = await executeRequest(prepared, signal, { onCookieUpdate: cookies => { result.cookies = cookies; }, onAuthUpdate: tokens => {
      result.authUpdates = [{ scope: inherited ? 'collection' : 'request', id: inherited ? input.collection!.id : input.request.id,
        configurationKey: authConfigurationKey(inherited ? input.collection!.auth : input.request), oauth2: tokens }];
    } });
    await script(input.collection?.postResponseScript, 'Collection post-response');
    await script(input.request.postResponseScript, 'Request post-response');
    for (const assertion of input.request.assertions) {
      if (!assertion.enabled) continue;
      try {
        const expectedText = assertion.operator === 'exists' ? '' : interpolate(assertion.expected, scope());
        let expected: unknown = expectedText;
        try { expected = JSON.parse(expectedText); } catch { /* Unquoted values are text. */ }
        const actual = responseValue(result.response, assertion.source, interpolate(assertion.path, scope()));
        const passed = compare(actual, expected, assertion.operator);
        result.tests.push({ name: assertion.name || 'Assertion', passed, kind: 'assertion', ...(!passed ? { error: `Expected ${assertion.source} ${assertion.path || ''} to ${assertion.operator} ${expectedText}.` } : {}) });
      } catch (error) { result.tests.push({ name: assertion.name || 'Assertion', passed: false, kind: 'assertion', error: (error as Error).message }); }
    }
    for (const extraction of input.request.extractions) {
      if (!extraction.enabled) continue;
      try {
        const extracted = responseValue(result.response, extraction.source, interpolate(extraction.path, scope()));
        if (extracted === undefined) throw new Error('Response value was not found.');
        const name = extraction.variable.trim();
        if (!name || name.length > 255) throw new Error('Provide a variable name (up to 255 characters).');
        commit([{ scope: extraction.scope, name, value: variableString(extracted) }]);
        result.tests.push({ name: extraction.name || `Extract ${name}`, passed: true, kind: 'extraction' });
      } catch (error) {
        result.tests.push({ name: extraction.name || 'Extraction', passed: !extraction.required, kind: 'extraction', error: (error as Error).message });
      }
    }
    result.passed = result.tests.every(test => test.passed);
  } catch (error) { result.error = signal?.aborted ? 'Request cancelled.' : (error as Error).message; }
  return result;
}
