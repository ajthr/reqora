import { Worker } from 'node:worker_threads';
import { MAX_SCRIPT_LENGTH } from '../shared/automation.ts';
import type { CheckResult, DataRow, ScriptLog, VariableChange } from '../shared/automation.ts';
import type { Draft } from '../shared/workspace.ts';
import type { HttpResponse } from '../shared/types.ts';

export interface ScriptInput {
  script: string; phase: string; request: Draft; response?: HttpResponse; globals: Record<string, string>;
  collection: Record<string, string>; data: DataRow; hasCollection: boolean; iteration: number;
}
export interface ScriptOutput { request: Draft; changes: VariableChange[]; tests: CheckResult[]; logs: ScriptLog[]; error?: string }

export function runScript(input: ScriptInput, signal?: AbortSignal): Promise<ScriptOutput> {
  if (input.script.length > MAX_SCRIPT_LENGTH) return Promise.reject(new Error('Scripts are limited to 32 KB.'));
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './script-worker.ts' : './script-worker.js', import.meta.url), {
      workerData: input, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 2 },
    });
    const finish = (error?: Error, output?: ScriptOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate();
      if (error) reject(error); else resolve(output!);
    };
    const abort = () => finish(new Error('Request cancelled.'));
    const timer = setTimeout(() => finish(new Error('Script exceeded its 3 second worker limit.')), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    worker.once('exit', code => { if (code !== 0) finish(new Error('Script worker stopped (time or memory limit).')); });
    worker.once('message', (message: { error?: string; output?: string }) => {
      try {
        if (message.error) throw new Error(message.error);
        if (!message.output || message.output.length > 20 * 1024 * 1024) throw new Error('Script output exceeds its limit.');
        const output = JSON.parse(message.output) as ScriptOutput;
        if (!Array.isArray(output.tests) || !Array.isArray(output.logs) || !Array.isArray(output.changes)) throw new Error('Invalid script result.');
        finish(undefined, output);
      } catch (error) { finish(error as Error); }
    });
  });
}
