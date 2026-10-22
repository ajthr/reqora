import type { Entry } from '../lib/workspace';
import { newEntry } from '../lib/workspace';
import Icon from './Icon';

export default function KeyValueEditor({ rows, onChange, kind = 'parameter' }: { rows: Entry[]; onChange: (rows: Entry[]) => void; kind?: string }) {
  const update = (id: string, field: keyof Entry, value: string | boolean) => onChange(rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  return <div className="key-values">
    <div className="kv-heading"><span /><span>KEY</span><span>VALUE</span><span /></div>
    {rows.map(row => <div className={`kv-row ${!row.enabled ? 'disabled-row' : ''}`} key={row.id}>
      <label className="row-check"><input type="checkbox" aria-label={`Enable ${row.name || kind}`} checked={row.enabled} onChange={event => update(row.id, 'enabled', event.target.checked)} /></label>
      <input aria-label={`${kind} key`} placeholder={kind === 'variable' ? 'base_url' : 'Key'} value={row.name} onChange={event => update(row.id, 'name', event.target.value)} spellCheck={false} />
      <input aria-label={`${kind} value`} placeholder={kind === 'variable' ? 'https://api.example.com' : 'Value'} value={row.value} onChange={event => update(row.id, 'value', event.target.value)} spellCheck={false} />
      <button className="icon-button row-delete" title={`Remove ${kind}`} onClick={() => onChange(rows.filter(item => item.id !== row.id))}><Icon name="close" size={14} /></button>
    </div>)}
    <button className="text-button add-row" onClick={() => onChange([...rows, newEntry()])}><Icon name="plus" size={15} /> Add {kind}</button>
  </div>;
}
