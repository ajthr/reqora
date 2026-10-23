import { useState } from 'react';
import { isCookieRecord, MAX_COOKIES } from '../../shared/network';
import type { CookieRecord } from '../../shared/network';
import Icon from './Icon';

const blank = (domain: string): CookieRecord => ({ id: crypto.randomUUID(), name: '', value: '', domain: domain.toLowerCase(), path: '/', hostOnly: true, secure: false, httpOnly: false, sameSite: '', expiresAt: null, createdAt: Date.now() });
export default function CookieEditor({ cookies, defaultDomain, onChange, onClear }: { cookies: CookieRecord[]; defaultDomain: string; onChange: (cookies: CookieRecord[]) => void; onClear: () => void }) {
  const [filter, setFilter] = useState(''), [draft, setDraft] = useState<CookieRecord | null>(null), [error, setError] = useState(''), [showValue, setShowValue] = useState(false);
  const shown = cookies.filter(cookie => `${cookie.name} ${cookie.domain} ${cookie.path}`.toLowerCase().includes(filter.toLowerCase()));
  const field = (label: string, value: string, update: (value: string) => void, secret = false) => <label className="field-label">{label}<input className="field-input" type={secret && !showValue ? 'password' : 'text'} autoComplete="off" value={value} onChange={event => update(event.target.value)} /></label>;
  function save() {
    if (!draft) return;
    const next = { ...draft, domain: draft.domain.trim().toLowerCase(), path: draft.path.trim() || '/' };
    if (!isCookieRecord(next)) { setError('Enter a valid cookie name, value, domain, and path. Values cannot contain semicolons or line breaks.'); return; }
    if (cookies.some(item => item.id !== next.id && item.name === next.name && item.domain === next.domain && item.path === next.path)) { setError('A cookie with that name, domain, and path already exists.'); return; }
    const updated = [...cookies.filter(item => item.id !== next.id), next];
    if (updated.length > MAX_COOKIES || JSON.stringify(updated).length > 1024 * 1024) { setError('The cookie jar is full. Delete some cookies first.'); return; }
    onChange(updated); setDraft(null); setError('');
  }
  return <div className="cookie-editor">
    <p className="automation-help">Reqora stores cookies in this workspace and sends matching cookies with requests that enable the jar. Session cookies also stay available after restarting Reqora.</p>
    <div className="cookie-toolbar"><input className="field-input" aria-label="Filter cookies" placeholder="Filter by name, domain, or path" value={filter} onChange={event => setFilter(event.target.value)} /><button className="button button-secondary" disabled={cookies.length >= MAX_COOKIES} onClick={() => { setDraft(blank(defaultDomain)); setError(''); }}><Icon name="plus" size={14} /> Add cookie</button>{cookies.length > 0 && <button className="text-button" onClick={onClear}>Clear all</button>}</div>
    {shown.length ? <div className="cookie-list">{shown.map(cookie => <div className="cookie-row" key={cookie.id}><div><strong>{cookie.name}</strong><span>{cookie.domain}{cookie.path} · {cookie.secure ? 'Secure · ' : ''}{cookie.httpOnly ? 'HttpOnly · ' : ''}{cookie.expiresAt === null ? 'Session' : new Date(cookie.expiresAt).toLocaleString()}</span></div><button className="text-button" aria-label={`Edit cookie ${cookie.name}`} onClick={() => { setDraft(cookie); setError(''); }}>Edit</button><button className="icon-button" aria-label={`Delete cookie ${cookie.name}`} onClick={() => onChange(cookies.filter(item => item.id !== cookie.id))}><Icon name="trash" size={15} /></button></div>)}</div> : <p className="automation-help">{cookies.length ? 'No cookies match the filter.' : 'No cookies have been stored yet.'}</p>}
    {draft && <section className="cookie-form"><h3>{cookies.some(item => item.id === draft.id) ? 'Edit cookie' : 'Add cookie'}</h3><div className="auth-field-grid">
      {field('Name', draft.name, name => setDraft({ ...draft, name }))}
      <label className="field-label">Value<input className="field-input" type={showValue ? 'text' : 'password'} autoComplete="off" value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} /><span className="cookie-show"><input type="checkbox" checked={showValue} onChange={event => setShowValue(event.target.checked)} />Show value</span></label>
      {field('Domain', draft.domain, domain => setDraft({ ...draft, domain }))}{field('Path', draft.path, path => setDraft({ ...draft, path }))}
      <label className="field-label">Expires (leave blank for session)<input className="field-input" type="datetime-local" value={draft.expiresAt === null ? '' : new Date(draft.expiresAt).toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16)} onChange={event => setDraft({ ...draft, expiresAt: event.target.value ? new Date(event.target.value).getTime() : null })} /></label>
      <label className="field-label">SameSite<select className="field-input" value={draft.sameSite} onChange={event => setDraft({ ...draft, sameSite: event.target.value as CookieRecord['sameSite'] })}><option value="">Unspecified</option><option value="lax">Lax</option><option value="strict">Strict</option><option value="none">None</option></select></label>
    </div><div className="cookie-flags"><label><input type="checkbox" checked={draft.hostOnly} onChange={event => setDraft({ ...draft, hostOnly: event.target.checked })} />Exact host only</label><label><input type="checkbox" checked={draft.secure} onChange={event => setDraft({ ...draft, secure: event.target.checked })} />Secure (HTTPS)</label><label><input type="checkbox" checked={draft.httpOnly} onChange={event => setDraft({ ...draft, httpOnly: event.target.checked })} />HttpOnly</label></div>
      {error && <p className="error-text" role="alert">{error}</p>}<div className="modal-footer"><button className="button button-secondary" onClick={() => { setDraft(null); setError(''); }}>Cancel</button><button className="button button-primary" onClick={save}>Save cookie</button></div></section>}
  </div>;
}
