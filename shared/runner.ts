import { applyVariableChanges, MAX_EXECUTIONS } from './automation.ts';
import type { ExecutionInput, ExecutionResult, RunItem, RunReport, RunnerOptions } from './automation.ts';
import { validateDataRows } from './data.ts';
import type { Draft, Workspace } from './workspace.ts';

export function planRun(workspace: Workspace, collectionId: string, options: RunnerOptions) {
  const collection = workspace.collections.find(item => item.id === collectionId);
  if (!collection) throw new Error('Collection not found.');
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 1000) throw new Error('Iterations must be between 1 and 1000.');
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0 || options.delayMs > 60_000) throw new Error('Delay must be between 0 and 60000 milliseconds.');
  validateDataRows(options.data);
  const saved = workspace.saved.filter(item => item.collectionId === collectionId).map(item => item.request);
  const ids = options.requestIds ?? saved.map(item => item.id);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Select at least one request, without duplicate selections.');
  const requests = ids.map(id => { const found = saved.find(item => item.id === id); if (!found) throw new Error('A selected request is not in this collection.'); return found; });
  const planned = requests.length * options.iterations * Math.max(1, options.data.length);
  if (planned > MAX_EXECUTIONS) throw new Error(`A run can contain up to ${MAX_EXECUTIONS} request executions. Reduce requests, iterations, or data rows.`);
  return { collection, requests, planned };
}

export async function runCollection(workspace: Workspace, collectionId: string, options: RunnerOptions, hooks: {
  execute: (input: ExecutionInput, signal?: AbortSignal) => Promise<ExecutionResult>;
  files?: (request: Draft, signal?: AbortSignal) => Promise<Record<string, string>>;
  signal?: AbortSignal;
  onResult?: (item: RunItem, report: RunReport) => void;
}): Promise<RunReport> {
  const plan = planRun(workspace, collectionId, options);
  let current = structuredClone(workspace);
  const start = Date.now();
  const report: RunReport = { version: 1, collectionId, collectionName: plan.collection.name, startedAt: new Date(start).toISOString(), durationMs: 0, planned: plan.planned, completed: 0, passed: 0, failed: 0, cancelled: false, results: [], changes: [] };
  const rows = options.data.length ? options.data : [{}];
  let detailBudget = 8 * 1024 * 1024;
  outer: for (let pass = 0; pass < options.iterations; pass++) for (let dataIndex = 0; dataIndex < rows.length; dataIndex++) for (const request of plan.requests) {
    if (hooks.signal?.aborted) { report.cancelled = true; break outer; }
    if (report.completed && options.delayMs) {
      try { await wait(options.delayMs, hooks.signal); } catch { report.cancelled = true; break outer; }
    }
    let result: ExecutionResult;
    try {
      const files = await hooks.files?.(request, hooks.signal);
      result = await hooks.execute({ request, globals: current.variables, collection: current.collections.find(item => item.id === collectionId), data: rows[dataIndex], files, iteration: pass * rows.length + dataIndex }, hooks.signal);
    } catch (error) {
      if (hooks.signal?.aborted) { report.cancelled = true; break outer; }
      result = { error: (error as Error).message, passed: false, tests: [], logs: [], changes: [] };
    }
    if (hooks.signal?.aborted) { report.cancelled = true; break outer; }
    current = applyVariableChanges(current, result.changes, collectionId);
    report.changes = variableDelta(workspace, current, collectionId);
    const tests: RunItem['tests'] = [], logs: RunItem['logs'] = [];
    for (const [source, destination] of [[result.tests, tests], [result.logs, logs]] as const) for (const detail of source) {
      const size = new TextEncoder().encode(JSON.stringify(detail)).length;
      if (size <= detailBudget) { (destination as unknown[]).push(detail); detailBudget -= size; }
    }
    const item: RunItem = { requestId: request.id, name: request.name.slice(0, 500), method: request.method, url: (result.response?.url || request.url).slice(0, 4096), iteration: pass * rows.length + dataIndex, dataIndex,
      status: result.response?.status, durationMs: result.response?.durationMs, error: result.error?.slice(0, 2000), passed: result.passed, tests, logs,
      testCounts: { passed: result.tests.filter(test => test.passed).length, failed: result.tests.filter(test => !test.passed).length }, detailsTruncated: tests.length !== result.tests.length || logs.length !== result.logs.length };
    report.results.push(item); report.completed++; report.passed += Number(item.passed); report.failed += Number(!item.passed);
    report.durationMs = Date.now() - start;
    hooks.onResult?.(item, report);
    if (!item.passed && options.stopOnFailure) break outer;
  }
  report.durationMs = Date.now() - start;
  return report;
}

function variableDelta(original: Workspace, current: Workspace, collectionId: string): RunReport['changes'] {
  const changes: RunReport['changes'] = [];
  for (const scope of ['global', 'collection'] as const) {
    const entries = (workspace: Workspace) => scope === 'global' ? workspace.variables : workspace.collections.find(item => item.id === collectionId)?.variables || [];
    const before = new Map(entries(original).map(row => [row.name.trim(), row]));
    const after = new Map(entries(current).map(row => [row.name.trim(), row]));
    for (const name of before.keys()) if (name && !after.has(name)) changes.push({ scope, name });
    for (const [name, row] of after) if (name && row.enabled && (!before.get(name)?.enabled || before.get(name)?.value !== row.value)) changes.push({ scope, name, value: row.value });
  }
  return changes;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Run cancelled.')); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
