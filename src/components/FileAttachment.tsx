import { useEffect, useId, useRef, useState } from 'react';
import { getAttachment, storeAttachment } from '../lib/attachments';
import { formatSize } from '../lib/workspace';
import type { FileReference } from '../lib/workspace';
import Icon from './Icon';

export default function FileAttachment({ file, onChange, label = 'Body file' }: {
  file?: FileReference; onChange: (file: FileReference | undefined) => void; label?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState(false);
  const generation = useRef(0);
  const change = useRef(onChange);
  change.current = onChange;
  const help = useId();
  useEffect(() => {
    let active = true;
    setMissing(false);
    if (file) void getAttachment(file).then(blob => { if (active) setMissing(!blob); });
    return () => { active = false; };
  }, [file]);
  useEffect(() => () => { generation.current++; }, []);

  async function attach(files: FileList) {
    if (files.length !== 1) { setMessage('Drop or paste one file per field. Add another field for additional files.'); return; }
    const current = ++generation.current;
    setBusy(true); setMessage('');
    try {
      const result = await storeAttachment(files[0]);
      if (generation.current !== current) return;
      change.current(result.reference);
      setMessage(result.temporary ? 'Available for this session only; persistent file storage is unavailable.' : 'Stored on this device. Drop or paste another file to replace it.');
    } catch (error) { if (generation.current === current) setMessage((error as Error).message); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <div className="file-attachment">
    <div className={`file-drop-zone ${dragging ? 'dragging' : ''} ${missing ? 'missing-file' : ''}`} role="group" tabIndex={0} aria-label={label} aria-describedby={help} aria-busy={busy}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); void attach(event.dataTransfer.files); }}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(event.clipboardData.files); } }}>
      <Icon name={file ? 'file' : 'upload'} size={20} />
      <div className="attachment-copy"><strong>{busy ? 'Storing file…' : file?.name || 'Drop a file or paste it here'}</strong><span id={help}>{file ? `${formatSize(file.size)} · ${file.type || 'application/octet-stream'}` : 'Focus this area and paste a file, or drag one from your file manager. Up to 10 MB.'}</span></div>
      {file && <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => { generation.current++; setBusy(false); setMessage(''); change.current(undefined); }}><Icon name="close" size={16} /></button>}
    </div>
    {missing && <p className="attachment-message error-text" role="alert">File unavailable on this device. Drop or paste it again to reattach.</p>}
    {message && <p className="attachment-message" role="status">{message}</p>}
  </div>;
}
