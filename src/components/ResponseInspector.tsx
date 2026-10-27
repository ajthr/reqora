import { useMemo, useState } from 'react';
import type { HttpResponse } from '../../shared/types.ts';
import type { ResponseExample } from '../../shared/workspace.ts';
import { pathKeys, readPath } from '../../shared/automation';
import CodeView from './CodeView';
import JsonTree from './JsonTree';
import { formatBody, formatSize } from '../lib/workspace';
import { compareResponses, sandboxedHtml } from '../lib/responses';

export type ResponseView = 'Body' | 'Tree' | 'Preview' | 'Compare' | 'Headers' | 'Cookies' | 'Details' | 'Tests';
export function responseCookies(response: HttpResponse) { return response.headers.filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value); }
export default function ResponseInspector({ response, view, pretty, search, requestMethod, requestUrl, examples = [], onDownload, onCopy }: { response: HttpResponse; view: ResponseView; pretty: boolean; search: string; requestMethod: string; requestUrl: string; examples?: ResponseExample[]; onDownload: () => void; onCopy: (text: string) => void }) {
  const contentType = response.headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
  const media = contentType.split(';')[0].trim().toLowerCase();
  const body = useMemo(() => formatBody(response, pretty), [response, pretty]);
  const [path, setPath] = useState('');
  const [exampleId, setExampleId] = useState('');
  const baseline = examples.find(item => item.id === exampleId) || examples[0];
  const comparison = useMemo(() => view === 'Compare' && baseline ? compareResponses(response, baseline) : undefined, [response, baseline, view]);
  const parsed = useMemo(() => {
    if (view !== 'Tree') return { value: undefined, error: '' };
    try {
      if (response.encoding !== 'utf8') throw new Error('Binary responses cannot be viewed as JSON.');
      try { return { value: JSON.parse(response.body) as unknown, error: '' }; } catch { throw new Error('The response body is not valid JSON. Use Body or Preview to inspect it.'); }
    } catch (error) { return { value: undefined, error: (error as Error).message }; }
  }, [response, view]);
  const filtered = useMemo(() => {
    try {
      if (parsed.error) throw new Error(parsed.error);
      const value = readPath(parsed.value, path.trim());
      if (value === undefined) throw new Error('This path was not found in the response.');
      const pointer = pathKeys(path.trim()).map(key => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
      return { value, pointer, error: '' };
    } catch (error) { return { value: undefined, pointer: '', error: (error as Error).message }; }
  }, [parsed, path]);
  if (view === 'Tree') return <div className="response-tree"><label className="field-label">JSON path or pointer<input className="field-input" value={path} placeholder="$.user.id or /users/0" onChange={event => setPath(event.target.value)} spellCheck={false} /></label><p className="automation-help">Filter with dot/array paths or JSON pointers. Copy a field's path or complete value. Wildcards and recursive JSONPath expressions are not supported.</p>{filtered.error ? <p className="error-text" role="status">{filtered.error}</p> : <JsonTree key={path} value={filtered.value} path={filtered.pointer} onCopy={onCopy} />}</div>;
  if (view === 'Compare') return <div className="response-comparison">{!baseline ? <p className="automation-help">Save this response as an example, then send the request again to compare status, headers, and body.</p> : <>
    <label className="field-label">Compare with saved example<select className="field-input" value={baseline.id} onChange={event => setExampleId(event.target.value)}>{examples.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
    <p className="automation-help">JSON objects are compared by value; whitespace and object property order are ignored. Text and binary bodies are compared exactly.</p>
    {comparison?.bodySkipped && <p className="preview-notice">The saved example was truncated. Only status and headers are compared.</p>}
    {comparison?.limited && <p className="preview-notice">Comparison reached its limit of 100 differences / 10,000 nodes / 40 levels. Some fields were not compared.</p>}
    <div className="response-comparison-summary"><strong role="status">{comparison?.differences.length || 0}{comparison?.limited ? '+' : ''} differences</strong><button className="text-button" onClick={() => onCopy(JSON.stringify(comparison, null, 2))}>Copy comparison</button></div>
    {comparison?.differences.length ? <table className="response-diff"><thead><tr><th>Field</th><th>Saved example</th><th>Current response</th></tr></thead><tbody>{comparison.differences.map((difference, index) => <tr key={index}><th scope="row">{difference.path}</th><td><code>{difference.before}</code></td><td><code>{difference.after}</code></td></tr>)}</tbody></table> : <p className="automation-help">No differences in the compared fields.</p>}
  </>}</div>;
  if (view === 'Headers') return <div className="response-headers">{response.headers.map((header, index) => <div key={index}><span>{header.name}</span><span>{header.value}</span></div>)}</div>;
  if (view === 'Cookies') { const cookies = responseCookies(response); return cookies.length ? <div className="response-headers">{cookies.map((cookie, index) => <div key={index}><span>{cookie.split('=')[0]}</span><span>{cookie}</span></div>)}</div> : <div className="response-empty"><p>No Set-Cookie headers were returned.</p></div>; }
  if (view === 'Details') return <dl className="response-details"><div><dt>Request</dt><dd>{requestMethod} {requestUrl}</dd></div><div><dt>Final URL</dt><dd>{response.url}</dd></div><div><dt>Status</dt><dd>{response.status} {response.statusText}</dd></div><div><dt>Elapsed</dt><dd>{response.durationMs} ms</dd></div><div><dt>Decoded body</dt><dd>{formatSize(response.size)}</dd></div><div><dt>Response headers</dt><dd>{response.headers.length}</dd></div><div><dt>Content type</dt><dd>{contentType || 'Not provided'}</dd></div></dl>;
  if (view === 'Preview') {
    if (response.encoding === 'base64' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'].includes(media)) return <div className="response-image"><img src={`data:${media};base64,${response.body}`} alt="API response image" /></div>;
    if (response.encoding !== 'utf8' || !response.body) return <div className="response-empty"><p>No text preview is available.</p></div>;
    if (media.includes('html')) return <div className="response-preview"><p>HTML preview is sandboxed. Scripts, forms, and external resources are blocked.</p><iframe title="HTML response preview" sandbox="" referrerPolicy="no-referrer" srcDoc={sandboxedHtml(response.body)} /></div>;
    if (media.includes('json')) { try { return <CodeView text={JSON.stringify(JSON.parse(response.body), null, 2)} highlight />; } catch { return <><p className="preview-notice">Content type is JSON, but the body is not valid JSON.</p><CodeView text={response.body} highlight={false} /></>; } }
    if (media.includes('xml') || media.startsWith('text/')) return <CodeView text={response.body} highlight={false} />;
    return <div className="response-empty"><p>No preview is available for {contentType || 'this content type'}.</p></div>;
  }
  if (response.encoding === 'base64') return <div className="response-empty"><h2>Binary response</h2><p>{formatSize(response.size)} received. Download the response to open it.</p><button className="button button-secondary" onClick={onDownload}>Download</button></div>;
  if (!response.body) return <div className="response-empty"><h2>Request complete</h2><p>The server returned an empty response body.</p></div>;
  return <CodeView text={body} highlight={pretty && media.includes('json')} search={search} />;
}
