import { MAX_API_BYTES } from '../../shared/body.ts';
import type { ExecutionInput, ExecutionResult } from '../../shared/automation.ts';

export async function executeAutomation(input: ExecutionInput, signal?: AbortSignal): Promise<ExecutionResult> {
  const body = JSON.stringify(input);
  if (new TextEncoder().encode(body).length > MAX_API_BYTES) throw new Error('Execution payload exceeds the 16 MB limit. Reduce attached files or variable data.');
  const response = await fetch('/api/run-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(response.status === 413 ? 'Execution payload exceeds the 16 MB limit.' : 'The request engine is unavailable.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to execute request.');
  return result as ExecutionResult;
}
