import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';
import { SCRIPT_API } from './script-api.ts';

try {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 750;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    const code = `(function(input){${SCRIPT_API}})(${JSON.stringify(workerData)})`;
    const result = context.evalCode(code, 'reqora-script.js');
    if (result.error) {
      const error = context.dump(result.error) as { message?: string };
      result.error.dispose();
      throw new Error(error?.message || 'Script exceeded its time or memory limit.');
    }
    if (runtime.hasPendingJob()) { result.value.dispose(); throw new Error('Asynchronous scripts are unsupported. Use synchronous rq APIs.'); }
    const output = context.getString(result.value);
    result.value.dispose();
    parentPort?.postMessage({ output });
  } finally { context.dispose(); runtime.dispose(); }
} catch (error) { parentPort?.postMessage({ error: (error as Error).message }); }
