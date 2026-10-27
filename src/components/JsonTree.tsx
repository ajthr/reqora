import { useState } from 'react';
import { displayValue } from '../lib/responses';

export default function JsonTree({ value, path = '', label = '$', depth = 0, onCopy }: {
  value: unknown; path?: string; label?: string; depth?: number; onCopy: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [count, setCount] = useState(100);
  const [error, setError] = useState('');
  const container = value !== null && typeof value === 'object';
  const keys = container ? Object.keys(value) : [];
  return <div className="json-tree-node">
    <div className="json-tree-heading">
      {container && keys.length ? <button className="json-tree-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${path || '$'}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '▾' : '▸'}</button> : <span className="json-tree-spacer" />}
      <strong>{label}</strong><code>{container ? `${Array.isArray(value) ? 'Array' : 'Object'} (${keys.length})` : displayValue(value, 500)}</code>
      <button className="text-button" aria-label={`Copy path ${path || '$'}`} onClick={() => onCopy(path || '$')}>Path</button>
      <button className="text-button" aria-label={`Copy value ${path || '$'}`} onClick={() => { try { const text = JSON.stringify(value, null, 2); onCopy(text); setError(''); } catch { setError('This value is too deeply nested to copy. Download the full response instead.'); } }}>Copy</button>
    </div>
    {error && <p className="error-text" role="status">{error}</p>}
    {expanded && container && (depth >= 30 ? <p className="preview-notice">Tree depth limit reached. Copy this value to inspect it.</p> : <div className="json-tree-children">
      {keys.slice(0, count).map(key => <JsonTree key={key} value={(value as Record<string, unknown>)[key]} label={Array.isArray(value) ? `[${key}]` : key} path={`${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`} depth={depth + 1} onCopy={onCopy} />)}
      {keys.length > count && <button className="text-button" onClick={() => setCount(count + 100)}>Show next {Math.min(100, keys.length - count)} of {keys.length - count} remaining</button>}
    </div>)}
  </div>;
}
