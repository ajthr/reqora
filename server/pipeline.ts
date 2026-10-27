import { executeRequest, RequestError } from './execute.ts';
import { runScript } from './scripts.ts';
import { applyVariableChanges, responseValue, variableString } from '../shared/automation.ts';
import type { ExecutionInput, ExecutionResult, VariableChange } from '../shared/automation.ts';
import { validateDataRows } from '../shared/data.ts';
import { getVariableScope, interpolate, isDraft, parseWorkspace, prepareRequest } from '../shared/workspace.ts';
import type { Collection, Draft, Entry } from '../shared/workspace.ts';
import { inspectJsonSchema, matchingResponseSchema, validateJsonSchema } from '../shared/schema.ts';
import { checkValue, compareAssertion } from '../shared/assertions.ts';
import { authConfigurationKey } from '../shared/auth.ts';
import { isCookieJar, normalizedNetworkSettings } from '../shared/network.ts';
import { executeMock } from './mocks.ts';

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
    request = { ...output.request, preRequestScript: request.preRequestScript, postResponseScript: request.postResponseScript, assertions: request.assertions, extractions: request.extractions, schema: request.schema, mock: request.mock };
    commit(output.changes);
  };
  try {
    signal?.throwIfAborted();
    await script(input.collection?.preRequestScript, 'Collection pre-request');
    await script(input.request.preRequestScript, 'Request pre-request');
    if (request.schema?.enabled) for (const [phase, source] of [['Request', request.schema.manualRequest], ['Response', request.schema.manualResponse]] as const) {
      if (!source?.trim()) continue;
      try {
        const issues = inspectJsonSchema(JSON.parse(source));
        if (issues.length) {
          result.tests.push({ name: `${phase} schema configuration`, kind: 'schema', phase: 'Configuration', passed: false, issues, error: `${issues[0].path}: ${issues[0].message}` });
          result.error = `${phase} schema configuration is invalid.`; return result;
        }
      } catch {
        result.tests.push({ name: `${phase} schema configuration`, kind: 'schema', phase: 'Configuration', passed: false, error: 'Schema is not valid JSON.' });
        result.error = `${phase} schema configuration is invalid.`; return result;
      }
    }
    if (request.mock?.enabled) {
      result.mocked = true;
      result.mockScenario = request.mock.scenarios?.find(item => item.id === request.mock!.activeScenarioId)?.name;
      result.request = { method: request.method, url: request.url };
      result.response = await executeMock(request, scope(), signal);
    } else {
      const prepared = prepareRequest({ ...request, method: request.method.toUpperCase() }, state.variables, [...(state.collections[0]?.variables || []), ...rowEntries], new Map(Object.entries(input.files || {})), state.collections[0]?.auth);
      result.request = { method: prepared.method, url: prepared.url };
      const manualRequest = request.schema?.manualRequest?.trim();
      if (request.schema?.enabled && (manualRequest || request.schema.requestSchema !== undefined || request.schema.requestRequired) && (prepared.body !== undefined || manualRequest || request.schema.requestRequired)) {
        const name = manualRequest ? 'Request JSON schema' : 'OpenAPI request schema';
        try {
          if (typeof prepared.body !== 'string') throw new Error('Schema validation requires a JSON request body.');
          const schema = manualRequest ? JSON.parse(manualRequest) : request.schema.requestSchema;
          const issues = schema === undefined ? [] : validateJsonSchema(JSON.parse(prepared.body), schema, manualRequest ? undefined : state.collections[0]?.schemaDefinitions);
          result.tests.push({ name, kind: 'schema', phase: 'Request', passed: issues.length === 0, issues, ...(issues.length ? { error: `${issues[0].path}: ${issues[0].message}` } : {}) });
          if (issues.length) { result.error = `Request body does not match the ${manualRequest ? 'custom JSON' : 'OpenAPI'} schema.`; return result; }
        } catch (error) { result.tests.push({ name, kind: 'schema', phase: 'Request', passed: false, error: (error as Error).message }); result.error = `Request body could not be validated against the ${manualRequest ? 'custom JSON' : 'OpenAPI'} schema.`; return result; }
      }
      if (normalizedNetworkSettings(request.network).useCookies) prepared.cookies = input.cookies;
      const inherited = request.authType === 'inherit' && !!input.collection?.auth;
      result.response = await executeRequest(prepared, signal, { onCookieUpdate: cookies => { result.cookies = cookies; }, onAuthUpdate: tokens => {
        result.authUpdates = [{ scope: inherited ? 'collection' : 'request', id: inherited ? input.collection!.id : input.request.id,
          configurationKey: authConfigurationKey(inherited ? input.collection!.auth : input.request), oauth2: tokens }];
      } });
    }
    await script(input.collection?.postResponseScript, 'Collection post-response');
    await script(input.request.postResponseScript, 'Request post-response');
    if (request.schema?.enabled) {
      const settings = request.schema;
      const manual = settings.manualResponse.trim();
      const contentType = result.response.headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
      const selected = manual ? undefined : matchingResponseSchema(settings.responses || [], result.response.status, contentType);
      if (!manual && !settings.responses?.length && settings.requestSchema === undefined && !settings.manualRequest?.trim()) result.tests.push({ name: 'Response JSON schema', kind: 'schema', phase: 'Response', passed: false, error: 'Add a custom response schema or import an OpenAPI definition.' });
      if (manual || settings.responses?.length) {
        try {
          if (!manual && !selected) throw new Error(`No OpenAPI response schema matches status ${result.response.status} and ${contentType || 'unknown content type'}.`);
          if (selected && selected.schema === undefined) {
            const passed = !!selected.mediaType || !result.response.body;
            result.tests.push({ name: 'OpenAPI response schema', kind: 'schema', phase: 'Response', passed, ...(!passed ? { error: 'Expected an empty response body.' } : {}) });
          } else {
            if (result.response.encoding !== 'utf8') throw new Error('JSON schema cannot validate a binary response.');
            const schema = manual ? JSON.parse(manual) : selected!.schema;
            const body = JSON.parse(result.response.body);
            const issues = validateJsonSchema(body, schema, manual ? undefined : state.collections[0]?.schemaDefinitions);
            result.tests.push({ name: manual ? 'Response JSON schema' : 'OpenAPI response schema', kind: 'schema', phase: 'Response', passed: issues.length === 0, issues, ...(issues.length ? { error: `${issues[0].path}: ${issues[0].message}${issues.length > 1 ? ` (${issues.length} issues)` : ''}` } : {}) });
          }
        } catch (error) { result.tests.push({ name: manual ? 'Response JSON schema' : 'OpenAPI response schema', kind: 'schema', phase: 'Response', passed: false, error: (error as Error).message }); }
      }
    }
    for (const assertion of input.request.assertions) {
      if (!assertion.enabled) continue;
      try {
        const expectedText = ['exists', 'notExists'].includes(assertion.operator) ? '' : interpolate(assertion.expected, scope());
        let expected: unknown = expectedText;
        if (assertion.operator === 'isType') expected = expectedText.trim();
        else try { expected = JSON.parse(expectedText); } catch { /* Unquoted values are text. */ }
        const actual = responseValue(result.response, assertion.source, interpolate(assertion.path, scope()));
        const passed = compareAssertion(actual, expected, assertion.operator);
        result.tests.push({ name: assertion.name || 'Assertion', passed, kind: 'assertion', path: assertion.path, actual: checkValue(actual), expected: assertion.operator === 'exists' ? 'defined value' : assertion.operator === 'notExists' ? 'undefined' : checkValue(expected), ...(!passed ? { error: `Expected ${assertion.source} ${assertion.path || ''} to ${assertion.operator} ${expectedText}.` } : {}) });
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
