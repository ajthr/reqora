import { useEffect, useRef, useState } from 'react';
import { publicRunReport, applyVariableChanges } from '../../shared/automation';
import type { AuthenticationUpdate } from '../../shared/auth';
import type { CookieRecord } from '../../shared/network';
import type { RunReport, RunnerOptions } from '../../shared/automation';
import { parseRunData } from '../../shared/data';
import { planRun, runCollection } from '../../shared/runner';
import type { Workspace } from '../lib/workspace';
import { readRequestFiles } from '../lib/attachments';
import { executeAutomation } from '../lib/execution';
import Dialog from './Dialog';
import AutomationResults from './AutomationResults';
import Icon from './Icon';

export default function CollectionRunner({ workspace, collectionId, onClose, onWorkspaceChange, onAuthenticationUpdate, onCookieUpdate }: {
  workspace: Workspace; collectionId: string; onClose: () => void; onWorkspaceChange: (update: (workspace: Workspace) => Workspace) => void; onAuthenticationUpdate: (updates: AuthenticationUpdate[]) => void; onCookieUpdate: (cookies: CookieRecord[]) => void;
}) {
  const collection = workspace.collections.find(item => item.id === collectionId)!;
  const requests = workspace.saved.filter(item => item.collectionId === collectionId).map(item => item.request);
  const [order, setOrder] = useState(requests.map(request => request.id));
  const [selected, setSelected] = useState(order);
  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelay] = useState(0);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [persist, setPersist] = useState(false);
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [dataText, setDataText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<RunReport | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);
  let options: RunnerOptions | undefined, planned = 0, configError = '';
  try {
    options = { iterations, delayMs, stopOnFailure, data: parseRunData(dataText, format), requestIds: order.filter(id => selected.includes(id)) };
    planned = planRun(workspace, collectionId, options).planned;
  } catch (reason) { configError = (reason as Error).message; }
  async function start() {
    if (busy || !options || configError || abort.current) return;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setReport(null);
    try {
      const snapshot = structuredClone(workspace);
      const result = await runCollection(snapshot, collectionId, options, {
        execute: executeAutomation, signal: controller.signal,
        files: async (request, signal) => Object.fromEntries(await readRequestFiles(request, signal)),
        onAuthenticationUpdate,
        onCookieUpdate,
        onResult: (_item, progress) => { if (mounted.current) setReport({ ...progress, results: [...progress.results], changes: [...progress.changes] }); },
      });
      if (mounted.current) {
        setReport(result);
        if (persist) onWorkspaceChange(current => applyVariableChanges(current, result.changes, collectionId));
      }
    } catch (reason) { if (mounted.current) setError((reason as Error).message); }
    finally { abort.current = null; if (mounted.current) setBusy(false); }
  }
  async function loadFile(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('Data files must be 2 MB or smaller.'); return; }
    try { setDataText(await file.text()); setFormat(file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'); setError(''); }
    catch { setError('Unable to read the data file.'); }
  }
  function exportReport() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(publicRunReport(report), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reqora-run-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const move = (index: number, direction: number) => {
    const next = [...order]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setOrder(next);
  };
  return <Dialog title={`Run collection: ${collection.name}`} wide onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="collection-runner"><p className="automation-help">Saved requests run sequentially in the order below; save open edits first. Each data row is one iteration; the iteration count repeats the full dataset. Changes flow between requests within this run.</p>
      <fieldset disabled={busy} className="runner-configuration"><legend>Run configuration</legend>
        <div className="runner-options"><label>Iterations<input aria-label="Run iterations" type="number" min={1} max={1000} value={iterations} onChange={event => setIterations(Number(event.target.value))} /></label><label>Delay between requests (ms)<input type="number" min={0} max={60_000} value={delayMs} onChange={event => setDelay(Number(event.target.value))} /></label><label className="runner-check"><input type="checkbox" checked={stopOnFailure} onChange={event => setStopOnFailure(event.target.checked)} />Stop on failure</label><label className="runner-check"><input type="checkbox" checked={persist} onChange={event => setPersist(event.target.checked)} />Save variable changes to workspace</label></div>
        <div className="runner-request-list">{order.map((id, i) => { const request = requests.find(item => item.id === id)!; return <div key={id}><label><input type="checkbox" checked={selected.includes(id)} onChange={event => setSelected(current => event.target.checked ? [...current, id] : current.filter(item => item !== id))} /><span className={`method-label method-${request.method.toLowerCase()}`}>{request.method}</span><strong>{request.name}</strong></label><button className="icon-button" aria-label={`Move ${request.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="icon-button" aria-label={`Move ${request.name} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button></div>; })}</div>
        <label className="runner-data-label">Iteration data<select aria-label="Run data format" value={format} onChange={event => setFormat(event.target.value as 'json' | 'csv')}><option value="json">JSON array</option><option value="csv">CSV with headers</option></select></label>
        <textarea className="runner-data script-code" aria-label="Run data" value={dataText} placeholder={'[{"user_id": 1, "expected_status": 200}]\n\nPaste data here or drop a JSON/CSV file.'} onChange={event => setDataText(event.target.value)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void loadFile(event.dataTransfer.files[0]); }} spellCheck={false} />
        <p className="automation-help">Data values override collection/global values and are available as <code>{'{{column}}'}</code> or <code>rq.data.get("column")</code>. Data does not modify saved variables. Up to 1000 executions per run.</p>
      </fieldset>
      {(configError || error) && <p className="error-text" role="alert">{error || configError}</p>}
      <div className="runner-controls"><span>{busy ? `${report?.completed || 0} / ${planned} completed` : `${planned} request execution${planned === 1 ? '' : 's'}`}</span>{report && <button className="button button-secondary" onClick={exportReport} disabled={busy}><Icon name="download" size={15} />Export report</button>}{busy ? <button className="button button-danger" onClick={() => abort.current?.abort()}>Cancel run</button> : <button className="button button-primary" disabled={!!configError} onClick={() => void start()}><Icon name="send" size={15} />Run collection</button>}</div>
      {report && <section className="runner-results" aria-label="Collection run results"><div className="runner-summary"><strong>{report.passed} passed</strong><strong className={report.failed ? 'error-text' : ''}>{report.failed} failed</strong><span>{report.cancelled ? 'Cancelled' : busy ? 'Running' : `${report.completed} / ${report.planned} completed`} · {report.durationMs} ms</span></div>{report.results.length > 100 && <p className="automation-help">Showing the latest 100 executions. Export the report for all results.</p>}{report.results.slice(-100).map((item, i) => <details className="runner-result" key={`${item.iteration}:${item.requestId}:${i}`}><summary><span className={item.passed ? 'success-text' : 'error-text'}>{item.passed ? 'PASS' : 'FAIL'}</span><strong>{item.name}</strong><span>Iteration {item.iteration + 1} · {item.status || 'ERR'}</span></summary>{item.detailsTruncated && <p className="automation-help">Details truncated. Total checks: {item.testCounts?.passed || 0} passed, {item.testCounts?.failed || 0} failed.</p>}<AutomationResults tests={item.tests} logs={item.logs} error={item.error} /></details>)}</section>}
    </div>
  </Dialog>;
}
