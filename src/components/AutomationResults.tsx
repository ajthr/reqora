import type { CheckResult, ScriptLog } from '../../shared/automation';

export default function AutomationResults({ tests = [], logs = [], error }: { tests?: CheckResult[]; logs?: ScriptLog[]; error?: string }) {
  return <div className="automation-results">
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="automation-result-counts"><strong>{tests.filter(test => test.passed).length} passed</strong><strong className={tests.some(test => !test.passed) ? 'error-text' : ''}>{tests.filter(test => !test.passed).length} failed</strong></div>
    {!tests.length && <p className="automation-help">No assertions or script tests ran. Configure checks in the Tests tab or use rq.test in scripts.</p>}
    {tests.map((test, i) => <div className={`automation-check ${test.passed ? 'passed' : 'failed'}`} key={i}><span>{test.passed ? 'PASS' : 'FAIL'}</span><div><strong>{test.name}</strong><small>{test.phase || test.kind}{test.path ? ` · ${test.path}` : ''}</small>{test.error && <p>{test.error}</p>}
      {!test.passed && (test.expected !== undefined || test.actual !== undefined) && <dl className="check-comparison"><div><dt>Expected</dt><dd><code>{test.expected}</code></dd></div><div><dt>Actual</dt><dd><code>{test.actual}</code></dd></div></dl>}
      {!!test.issues?.length && <ul className="schema-issue-list">{test.issues.map((issue, index) => <li key={index}><code>{issue.path}</code><span>{issue.message}</span></li>)}</ul>}
    </div></div>)}
    {!!logs.length && <><h4>Script console</h4><div className="script-console">{logs.map((log, i) => <div key={i}><small>{log.phase} · {log.level}</small><pre>{log.message}</pre></div>)}</div></>}
  </div>;
}
