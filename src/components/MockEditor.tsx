import { useEffect, useState } from 'react';
import type { Draft, ResponseExample } from '../lib/workspace';
import { defaultMock, mockFromExample, mockResponseError, selectedMock } from '../../shared/mocks';
import type { MockResponse, MockSettings } from '../../shared/mocks';
import Icon from './Icon';

function MockNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const valid = text !== '' && Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;
  return <label className="field-label">{label}<input className="field-input" type="number" min={min} max={max} value={text} aria-invalid={!valid} onChange={event => {
    const next = event.target.value; setText(next);
    if (next !== '' && Number.isInteger(Number(next)) && Number(next) >= min && Number(next) <= max) onChange(Number(next));
  }} onBlur={() => setText(String(value))} />{!valid && <small>Enter an integer from {min} to {max}. The last valid value is kept.</small>}</label>;
}

export default function MockEditor({ draft, examples = [], onChange }: { draft: Draft; examples?: ResponseExample[]; onChange: (changes: Partial<Draft>) => void }) {
  const mock: MockSettings = draft.mock || defaultMock(), response = selectedMock(mock);
  const [name, setName] = useState(''), [error, setError] = useState('');
  const update = (changes: Partial<MockSettings>) => {
    const next = { ...mock, ...changes };
    if (JSON.stringify(next).length > 2_200_000) { setError('Mock configuration is too large. Remove scenarios or reduce their bodies/headers.'); return; }
    setError(''); onChange({ mock: next });
  };
  const edit = (changes: Partial<MockResponse>) => mock.activeScenarioId
    ? update({ scenarios: mock.scenarios?.map(item => item.id === mock.activeScenarioId ? { ...item, ...changes } : item) }) : update(changes);
  const failure = response.failure || 'none';
  const configurationError = mockResponseError(response);
  return <div className="mock-editor">
    <label className="network-inline"><input type="checkbox" checked={mock.enabled} onChange={event => update({ enabled: event.target.checked })} />Use a local mock response</label>
    <p className="automation-help">Local mocks skip HTTP. Choose a saved scenario to simulate success, errors, latency, or a binary response. Scripts, response checks, and extraction still run for returned responses. Save the request to use these settings in collection runs and CLI exports.</p>
    <label className="field-label">Active mock scenario<select className="field-input" value={mock.activeScenarioId || ''} onChange={event => { update({ activeScenarioId: event.target.value || undefined }); setError(''); setName(''); }}><option value="">Default response</option>{mock.scenarios?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="mock-scenario-controls"><input className="field-input" aria-label="Mock scenario name" value={name} maxLength={80} placeholder="Scenario name" onChange={event => setName(event.target.value)} /><button className="button button-secondary" disabled={!name.trim() || (mock.scenarios?.length || 0) >= 20} onClick={() => {
      const id = crypto.randomUUID();
      const names = new Set(mock.scenarios?.map(item => item.name));
      let label = name.trim(), index = 2;
      while (names.has(label)) label = `${name.trim().slice(0, 70)} (${index++})`;
      const { status, statusText, headers, body, encoding, delayMs, failure } = response;
      update({ activeScenarioId: id, scenarios: [...(mock.scenarios || []), { id, name: label, ...structuredClone({ status, statusText, headers, body, encoding, delayMs, failure }) }] }); setName('');
    }}>Add scenario</button>
    {mock.activeScenarioId && <><button className="text-button" disabled={!name.trim()} onClick={() => { update({ scenarios: mock.scenarios?.map(item => item.id === mock.activeScenarioId ? { ...item, name: name.trim() } : item) }); setName(''); }}>Rename selected</button><button className="text-button error-text" onClick={() => { update({ scenarios: mock.scenarios?.filter(item => item.id !== mock.activeScenarioId), activeScenarioId: undefined }); setName(''); }}>Remove selected</button></>}</div>
    <label className="field-label">Use saved response example<select className="field-input" value="" disabled={!examples.length} onChange={event => {
      const example = examples.find(item => item.id === event.target.value);
      if (!example) return;
      try { edit(mockFromExample(example)); setError(''); } catch (error) { setError((error as Error).message); }
    }}><option value="">Choose an example to copy into this scenario</option>{examples.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}{item.truncated ? ' · Truncated' : ''}</option>)}</select></label>
    <div className="mock-status"><MockNumber key={'delay-' + (mock.activeScenarioId || 'default')} label="Delay (ms)" min={0} max={60000} value={response.delayMs || 0} onChange={delayMs => edit({ delayMs })} /><label className="field-label">Simulate<select className="field-input" value={failure} onChange={event => edit({ failure: event.target.value as MockResponse['failure'] })}><option value="none">HTTP response</option><option value="network">Network failure</option><option value="timeout">Timeout failure</option></select></label></div>
    <p className="automation-help">Delay respects request timeout and cancellation. Simulated failures occur after the delay and return no response.</p>
    <fieldset className="mock-response-fields" disabled={failure !== 'none'}>
    <div className="mock-status"><MockNumber key={'status-' + (mock.activeScenarioId || 'default')} label="Status" min={100} max={599} value={response.status} onChange={status => edit({ status })} /><label className="field-label">Status text<input className="field-input" value={response.statusText} maxLength={200} onChange={event => edit({ statusText: event.target.value })} /></label></div>
    <h3>Response headers</h3>{response.headers.map((header, index) => <div className="mock-header" key={index}><input className="field-input" aria-label={`Mock header ${index + 1} name`} value={header.name} maxLength={255} onChange={event => edit({ headers: response.headers.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /><input className="field-input" aria-label={`Mock header ${index + 1} value`} value={header.value} maxLength={8192} onChange={event => edit({ headers: response.headers.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /><button className="icon-button" aria-label={`Remove mock header ${index + 1}`} onClick={() => edit({ headers: response.headers.filter((_, i) => i !== index) })}><Icon name="close" size={15} /></button></div>)}<button className="text-button" disabled={response.headers.length >= 30} onClick={() => edit({ headers: [...response.headers, { name: '', value: '' }] })}>Add header</button>
    <label className="field-label">Body encoding<select className="field-input" value={response.encoding || 'utf8'} onChange={event => edit({ encoding: event.target.value as MockResponse['encoding'] })}><option value="utf8">Text / JSON</option><option value="base64">Binary (base64)</option></select></label>
    <label className="field-label">Response body<textarea className="script-code mock-body" spellCheck={false} maxLength={100_000} value={response.body} onChange={event => edit({ body: event.target.value })} /></label>
    </fieldset>
    <p className="automation-help">Text bodies and header values support {'{{variables}}'}. Binary bytes are literal. HEAD, 1xx, 204, 205, and 304 mock responses have no body. These are in-app simulations, not hosted mock endpoints.</p>
    {(error || configurationError) && <p className="error-text" role="alert">{error || configurationError}</p>}
  </div>;
}
