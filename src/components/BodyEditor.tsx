import { useState } from 'react';
import { MAX_BODY_FIELDS } from '../../shared/body';
import { newEntry } from '../lib/workspace';
import type { Draft } from '../lib/workspace';
import FileAttachment from './FileAttachment';
import Icon from './Icon';
import KeyValueEditor from './KeyValueEditor';

const TYPES: { value: Draft['bodyType']; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'json', label: 'JSON' }, { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' }, { value: 'form', label: 'URL encoded' },
  { value: 'multipart', label: 'Multipart' }, { value: 'binary', label: 'Binary file' },
];

export default function BodyEditor({ draft, onChange }: { draft: Draft; onChange: (changes: Partial<Draft>) => void }) {
  const [error, setError] = useState('');
  if (['GET', 'HEAD'].includes(draft.method)) return <div className="inline-empty"><Icon name="file" size={24} /><div><strong>This request has no body</strong><p>{draft.method} requests send parameters in the URL. Choose POST, PUT, PATCH, or DELETE to send a body.</p></div></div>;
  const rows = draft.multipartFields;
  const update = (id: string, changes: Partial<Draft['multipartFields'][number]>) => onChange({ multipartFields: rows.map(row => row.id === id ? { ...row, ...changes } : row) });
  return <div className="request-body-editor">
    <div className="body-options" role="radiogroup" aria-label="Request body type">{TYPES.map(type => <label key={type.value}><input type="radio" name="bodyType" checked={draft.bodyType === type.value} onChange={() => { setError(''); onChange({ bodyType: type.value }); }} />{type.label}</label>)}
      {draft.bodyType === 'json' && <button type="button" className="text-button format-button" onClick={() => {
        try { onChange({ body: JSON.stringify(JSON.parse(draft.body), null, 2) }); setError(''); }
        catch { setError('Enter valid JSON before formatting.'); }
      }}>Format JSON</button>}
    </div>
    {error && <p className="body-error error-text" role="alert">{error}</p>}
    {draft.bodyType === 'none' && <div className="body-none">Choose a body type to include content with this request.</div>}
    {['json', 'text', 'xml'].includes(draft.bodyType) && <textarea className="body-editor" aria-label="Request body" spellCheck={false} placeholder={draft.bodyType === 'json' ? '{\n  "message": "Hello, world"\n}' : draft.bodyType === 'xml' ? '<message>Hello, world</message>' : 'Write your request body here…'} value={draft.body} onChange={event => onChange({ body: event.target.value })} />}
    {draft.bodyType === 'form' && <><p className="body-help">Checked fields are URL encoded automatically. Duplicate keys and empty values are supported.</p><KeyValueEditor rows={draft.formFields} kind="form field" onChange={formFields => onChange({ formFields })} /></>}
    {draft.bodyType === 'multipart' && <>
      <p className="body-help">Mix text and file fields. Add repeated keys for multiple values. Content-Type and its boundary are generated automatically.</p>
      <div className="multipart-table"><div className="multipart-heading"><span /><span>KEY</span><span>TYPE</span><span>VALUE / FILE</span><span /></div>
        {rows.map(row => <div key={row.id} className={`multipart-row ${!row.enabled ? 'disabled-row' : ''}`}>
          <label className="row-check"><input type="checkbox" aria-label={`Enable multipart ${row.name || 'field'}`} checked={row.enabled} onChange={event => update(row.id, { enabled: event.target.checked })} /></label>
          <input className="multipart-key" aria-label="Multipart field key" placeholder="Key" spellCheck={false} value={row.name} onChange={event => update(row.id, { name: event.target.value })} />
          <select aria-label={`Type for ${row.name || 'multipart field'}`} value={row.kind} onChange={event => update(row.id, { kind: event.target.value as 'text' | 'file' })}><option value="text">Text</option><option value="file">File</option></select>
          {row.kind === 'text' ? <input className="multipart-value" aria-label="Multipart field value" placeholder="Value or {{variable}}" spellCheck={false} value={row.value} onChange={event => update(row.id, { value: event.target.value })} /> : <FileAttachment file={row.file} label={`File for ${row.name || 'multipart field'}`} onChange={file => update(row.id, { file })} />}
          <button type="button" className="icon-button row-delete" aria-label={`Remove multipart ${row.name || 'field'}`} title="Remove field" onClick={() => onChange({ multipartFields: rows.filter(item => item.id !== row.id) })}><Icon name="close" size={14} /></button>
        </div>)}
        <button type="button" className="text-button add-row" disabled={rows.length >= MAX_BODY_FIELDS} onClick={() => onChange({ multipartFields: [...rows, { ...newEntry(), kind: 'text' }] })}><Icon name="plus" size={15} /> Add multipart field</button>
      </div>
    </>}
    {draft.bodyType === 'binary' && <div className="binary-body"><p className="body-help">Send a file's exact bytes as the entire request body. Its media type is used unless you set Content-Type in Headers.</p><FileAttachment file={draft.binaryFile} onChange={binaryFile => onChange({ binaryFile })} /></div>}
    {['multipart', 'binary'].includes(draft.bodyType) && <p className="body-file-note"><Icon name="lock" size={14} />Files stay on this device. Exports include file metadata; reattach files after moving a workspace to another device. Total request body limit: 10 MB.</p>}
  </div>;
}
