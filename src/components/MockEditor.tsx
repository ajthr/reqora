import type { Draft } from '../lib/workspace';
import type { MockSettings } from '../../shared/schema';
import Icon from './Icon';

export default function MockEditor({ draft, onChange }: { draft: Draft; onChange: (changes: Partial<Draft>) => void }) {
  const mock: MockSettings = draft.mock || { enabled: false, status: 200, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{}' };
  const update = (changes: Partial<MockSettings>) => onChange({ mock: { ...mock, ...changes } });
  return <div className="mock-editor">
    <label className="network-inline"><input type="checkbox" checked={mock.enabled} onChange={event => update({ enabled: event.target.checked })} />Use a local mock response</label>
    <p className="automation-help">Sending this request skips the network and returns the response below. Pre-request and post-response scripts, assertions, extraction, and schema checks still run.</p>
    <div className="mock-status"><label className="field-label">Status<input className="field-input" type="number" min={100} max={599} value={mock.status} onChange={event => update({ status: Number(event.target.value) })} /></label><label className="field-label">Status text<input className="field-input" value={mock.statusText} maxLength={200} onChange={event => update({ statusText: event.target.value })} /></label></div>
    <h3>Response headers</h3>{mock.headers.map((header, index) => <div className="mock-header" key={index}><input className="field-input" aria-label={`Mock header ${index + 1} name`} value={header.name} onChange={event => update({ headers: mock.headers.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /><input className="field-input" aria-label={`Mock header ${index + 1} value`} value={header.value} onChange={event => update({ headers: mock.headers.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /><button className="icon-button" aria-label={`Remove mock header ${index + 1}`} onClick={() => update({ headers: mock.headers.filter((_, i) => i !== index) })}><Icon name="close" size={15} /></button></div>)}<button className="text-button" disabled={mock.headers.length >= 30} onClick={() => update({ headers: [...mock.headers, { name: '', value: '' }] })}>Add header</button>
    <label className="field-label">Response body<textarea className="script-code mock-body" spellCheck={false} maxLength={100_000} value={mock.body} onChange={event => update({ body: event.target.value })} /></label>
  </div>;
}
