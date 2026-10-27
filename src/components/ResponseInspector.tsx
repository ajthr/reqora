import { useMemo } from 'react';
import type { HttpResponse } from '../../shared/types.ts';
import CodeView from './CodeView';
import { formatBody, formatSize } from '../lib/workspace';

export type ResponseView = 'Body' | 'Preview' | 'Headers' | 'Cookies' | 'Details' | 'Tests';
export function responseCookies(response: HttpResponse) { return response.headers.filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value); }
export default function ResponseInspector({ response, view, pretty, search, requestMethod, requestUrl, onDownload }: { response: HttpResponse; view: ResponseView; pretty: boolean; search: string; requestMethod: string; requestUrl: string; onDownload: () => void }) {
  const contentType = response.headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
  const body = useMemo(() => formatBody(response, pretty), [response, pretty]);
  const matches = search ? [...body.matchAll(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))].length : 0;
  if (view === 'Headers') return <div className="response-headers">{response.headers.map((header, index) => <div key={index}><span>{header.name}</span><span>{header.value}</span></div>)}</div>;
  if (view === 'Cookies') { const cookies = responseCookies(response); return cookies.length ? <div className="response-headers">{cookies.map((cookie, index) => <div key={index}><span>{cookie.split('=')[0]}</span><span>{cookie}</span></div>)}</div> : <div className="response-empty"><p>No Set-Cookie headers were returned.</p></div>; }
  if (view === 'Details') return <dl className="response-details"><div><dt>Request</dt><dd>{requestMethod} {requestUrl}</dd></div><div><dt>Final URL</dt><dd>{response.url}</dd></div><div><dt>Status</dt><dd>{response.status} {response.statusText}</dd></div><div><dt>Elapsed</dt><dd>{response.durationMs} ms</dd></div><div><dt>Decoded body</dt><dd>{formatSize(response.size)}</dd></div><div><dt>Response headers</dt><dd>{response.headers.length}</dd></div><div><dt>Content type</dt><dd>{contentType || 'Not provided'}</dd></div></dl>;
  if (view === 'Preview') {
    if (response.encoding !== 'utf8' || !response.body) return <div className="response-empty"><p>No text preview is available.</p></div>;
    if (contentType.includes('html')) return <div className="response-preview"><p>HTML preview is sandboxed. Scripts and forms are disabled.</p><iframe title="HTML response preview" sandbox="" srcDoc={response.body} /></div>;
    if (contentType.includes('json')) { try { return <pre className="response-structured">{JSON.stringify(JSON.parse(response.body), null, 2)}</pre>; } catch { /* Show text below. */ } }
    if (contentType.includes('xml') || contentType.startsWith('text/')) return <pre className="response-structured">{response.body}</pre>;
    return <div className="response-empty"><p>No preview is available for {contentType || 'this content type'}.</p></div>;
  }
  if (response.encoding === 'base64') return <div className="response-empty"><h2>Binary response</h2><p>{formatSize(response.size)} received. Download the response to open it.</p><button className="button button-secondary" onClick={onDownload}>Download</button></div>;
  if (!response.body) return <div className="response-empty"><h2>Request complete</h2><p>The server returned an empty response body.</p></div>;
  return <>{search && <p className="response-search-count">{matches} match{matches === 1 ? '' : 'es'} in displayed body</p>}<CodeView text={body} highlight={pretty && contentType.includes('json')} search={search} /></>;
}
