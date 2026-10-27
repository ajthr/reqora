import { useRef, useState } from 'react';
import Modal from './Dialog';
import Icon from './Icon';
import { MAX_TRANSFER_BYTES, previewTransfer } from '../lib/workspace-transfer';
import type { ImportOptions, TransferPreview } from '../lib/workspace-transfer';

export default function TransferImportDialog({ scope, activeWorkspaceName, onClose, onApply }: {
  scope: 'all' | 'environments'; activeWorkspaceName: string; onClose: () => void;
  onApply: (preview: TransferPreview, options: ImportOptions) => string | void;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [destination, setDestination] = useState<'new' | 'replace'>('new');
  const [activate, setActivate] = useState(true);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  function review(value: string) {
    try {
      const next = previewTransfer(value);
      if (scope === 'environments' && next.kind !== 'environments') throw new Error('Choose a Reqora or Postman environment export. Use Import in Workspaces for workspace exports.');
      setPreview(next); setError(''); setDestination('new');
    } catch (error) { setError(error instanceof SyntaxError ? 'This JSON is invalid. Paste a complete export or cURL command.' : (error as Error).message); }
  }
  async function read(file: File) {
    const version = ++readVersion.current;
    setReading(true); setError('');
    try {
      if (file.size > MAX_TRANSFER_BYTES) throw new Error('Imports must be smaller than 25 MB.');
      const value = await file.text();
      if (version !== readVersion.current) return;
      setText(value); review(value);
    } catch (error) { if (version === readVersion.current) setError((error as Error).message); }
    finally { if (version === readVersion.current) setReading(false); }
  }
  const records = preview?.kind === 'workspaces' ? preview.store.workspaces : [];
  const collections = preview?.kind === 'workspace' ? preview.workspace.collections.length : records.reduce((count, item) => count + item.data.collections.length, 0);
  const requests = preview?.kind === 'workspace' ? preview.workspace.saved.length : records.reduce((count, item) => count + item.data.saved.length, 0);
  const environments = preview?.kind === 'environments' ? preview.environments.length : preview?.kind === 'workspace' ? preview.workspace.environments?.length || 0 : records.reduce((count, item) => count + (item.data.environments?.length || 0), 0);
  return <Modal title={preview ? 'Review import' : scope === 'environments' ? 'Import environments' : 'Import workspaces and environments'} wide onClose={onClose}>
    {preview ? <>
      <p className="modal-description">Detected {preview.format}. Review the contents and destination before importing.</p>
      <div className="import-summary">
        {preview.kind === 'workspaces' ? <div><strong>{records.length}</strong><span>Workspaces</span></div> : preview.kind === 'environments' ? <div><strong>{(preview.variables || []).length}</strong><span>Base variables</span></div> : <div><strong>{collections}</strong><span>Collections</span></div>}
        {preview.kind !== 'environments' && <div><strong>{requests}</strong><span>Requests</span></div>}
        <div><strong>{environments}</strong><span>Environments</span></div>
      </div>
      {preview.kind === 'workspace' && <>
        <label className="field-label">Import destination<select className="field-input" value={destination} onChange={event => setDestination(event.target.value as 'new' | 'replace')}>
          <option value="new">New workspace: {preview.name}</option><option value="replace">Replace active workspace: {activeWorkspaceName}</option>
        </select></label>
        <p className="modal-description">{destination === 'new' ? 'Adds a separate workspace and opens it. Your existing workspaces are kept.' : 'Replaces saved collections, environments, variables, cookies, and history in the active workspace. Other workspaces are kept. Export a backup first if needed.'}</p>
      </>}
      {preview.kind === 'workspaces' && <><ul className="transfer-import-list">{records.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.data.collections.length} collections · {(item.data.environments || []).length} environments{item.id === preview.store.activeId ? ' · Opens after import' : ''}</span></li>)}</ul><p className="modal-description">All workspaces are added as new copies. Existing workspaces are kept; duplicate names receive a number.</p></>}
      {preview.kind === 'environments' && <>
        <p className="modal-description">Adds environments to “{activeWorkspaceName}”. Existing environments are kept; duplicate names receive a number. Imported base variables fill missing names and keep your existing values for matching names.</p>
        <ul className="transfer-import-list">{preview.environments.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.variables.length} variables</span></li>)}</ul>
        {preview.activeEnvironmentId && <label className="transfer-check"><input type="checkbox" checked={activate} onChange={event => setActivate(event.target.checked)} />Use the imported active environment</label>}
      </>}
      <p className="environment-note">Exports can contain credentials and cookies. File attachments contain metadata; reattach files after moving to another device.</p>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="button button-secondary" data-dialog-initial-focus onClick={() => { setPreview(null); setError(''); }}>Back</button><button className={`button ${preview.kind === 'workspace' && destination === 'replace' ? 'button-danger' : 'button-primary'}`} onClick={() => {
        const error = onApply(preview, { destination, activateEnvironments: activate });
        if (error) setError(error);
      }}>{preview.kind === 'environments' ? 'Import environments' : preview.kind === 'workspace' && destination === 'replace' ? 'Replace active workspace' : 'Import as new workspace' + (preview.kind === 'workspaces' ? 's' : '')}</button></div>
    </> : <>
      <p className="modal-description">{scope === 'environments' ? 'Import a Reqora environment export or a Postman environment JSON file into the active workspace.' : 'Import one workspace, an all-workspace backup, or environments. Reqora, Postman, Insomnia, OpenAPI JSON, and cURL are supported.'}</p>
      <div className={`import-drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => {
        event.preventDefault(); setDragging(false);
        if (event.dataTransfer.files.length !== 1) { setError('Choose one export file at a time.'); return; }
        void read(event.dataTransfer.files[0]);
      }}><Icon name="upload" size={26} /><strong>{reading ? 'Reading export…' : 'Drop an export file'}</strong><span>JSON or cURL · Up to 25 MB · Processed locally</span><button className="button button-secondary" disabled={reading} onClick={() => fileInput.current?.click()}>Choose file</button><input ref={fileInput} type="file" accept=".json,.txt,.curl" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); event.target.value = ''; }} /></div>
      <label className="field-label">Or paste JSON or cURL<textarea className="import-json" value={text} spellCheck={false} disabled={reading} onChange={event => { setText(event.target.value); setError(''); }} /></label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={reading || !text.trim()} onClick={() => review(text)}>Review import</button></div>
    </>}
  </Modal>;
}
