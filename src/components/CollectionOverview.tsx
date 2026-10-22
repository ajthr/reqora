import { useMemo, useState } from 'react';
import type { Collection, Draft, Entry } from '../lib/workspace';
import { getVariableScope, interpolate } from '../lib/workspace';
import ActionMenu from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import Icon from './Icon';
import KeyValueEditor from './KeyValueEditor';

export type CollectionSection = 'overview' | 'variables';

interface Props {
  collection: Collection;
  requests: Draft[];
  globals: Entry[];
  section: CollectionSection;
  onSectionChange: (section: CollectionSection) => void;
  onChange: (changes: Partial<Pick<Collection, 'description' | 'variables'>>) => void;
  onOpenRequest: (request: Draft) => void;
  onNewRequest: () => void;
  onGlobals: () => void;
  actions: MenuAction[];
  requestActions: (request: Draft) => MenuAction[];
}

export default function CollectionOverview({ collection, requests, globals, section, onSectionChange, onChange, onOpenRequest, onNewRequest, onGlobals, actions, requestActions }: Props) {
  const [search, setSearch] = useState('');
  const effective = useMemo(() => getVariableScope(globals, collection.variables), [globals, collection.variables]);
  const collectionCount = getVariableScope([], collection.variables).length;
  const globalCount = getVariableScope(globals).length;
  const filtered = requests.filter(request => `${request.name} ${request.url} ${request.method}`.toLowerCase().includes(search.toLowerCase()));
  const globalNames = new Set(getVariableScope(globals).map(entry => entry.name));

  return <section className="collection-overview" aria-label={`Collection overview: ${collection.name}`}>
    <div className="collection-page-heading">
      <div className="collection-page-title"><span className="collection-page-icon"><Icon name="folder" size={25} /></span><div><span className="collection-eyebrow">COLLECTION</span><h1>{collection.name}</h1></div></div>
      <div className="collection-page-actions"><button className="button button-primary" onClick={onNewRequest}><Icon name="plus" size={17} /> New request</button><ActionMenu label={`Options for collection ${collection.name}`} actions={actions} /></div>
    </div>
    <nav className="collection-page-tabs" aria-label="Collection sections">
      <button className={section === 'overview' ? 'active' : ''} onClick={() => onSectionChange('overview')}><Icon name="layers" size={16} />Overview</button>
      <button className={section === 'variables' ? 'active' : ''} onClick={() => onSectionChange('variables')}><Icon name="globe" size={16} />Variables<span>{collectionCount}</span></button>
    </nav>
    <div className="collection-page-content">
      {section === 'overview' ? <>
        <div className="collection-stats">
          <div><span className="stat-icon"><Icon name="file" size={19} /></span><strong>{requests.length}</strong><span>Saved request{requests.length === 1 ? '' : 's'}</span></div>
          <button onClick={() => onSectionChange('variables')}><span className="stat-icon"><Icon name="folder" size={19} /></span><strong>{collectionCount}</strong><span>Collection variable{collectionCount === 1 ? '' : 's'}</span><Icon name="arrow" size={15} /></button>
          <button onClick={onGlobals}><span className="stat-icon"><Icon name="globe" size={19} /></span><strong>{globalCount}</strong><span>Global variable{globalCount === 1 ? '' : 's'}</span><Icon name="arrow" size={15} /></button>
        </div>
        <section className="collection-description-section">
          <div className="collection-section-title"><h2>About this collection</h2><span>Saved automatically</span></div>
          <textarea className="collection-description" aria-label="Collection description" placeholder="Describe this API, what these requests do, or how to get started…" maxLength={5000} value={collection.description} onChange={event => onChange({ description: event.target.value })} />
        </section>
        <section className="collection-request-section">
          <div className="collection-section-title"><h2>Requests <span>{requests.length}</span></h2><label className="collection-request-search"><Icon name="search" size={15} /><input aria-label="Search collection requests" placeholder="Filter requests…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
          {filtered.length ? <div className="overview-request-list">{filtered.map(request => <div className="overview-request-row" key={request.id}><button onClick={() => onOpenRequest(request)} title={request.url}><span className={`method-label method-${request.method.toLowerCase()}`}>{request.method}</span><strong>{request.name}</strong><code>{request.url || 'No URL yet'}</code><Icon name="arrow" size={15} /></button><ActionMenu label={`Options for request ${request.name}`} actions={requestActions(request)} /></div>)}</div> : <div className="collection-empty-state"><Icon name={search ? 'search' : 'file'} size={28} /><h3>{search ? 'No matching requests' : 'Make your first request'}</h3><p>{search ? 'Try a different name, method, or URL.' : 'Add a request to start exploring this API.'}</p>{!search && <button className="button button-secondary" onClick={onNewRequest}><Icon name="plus" size={15} /> New request</button>}</div>}
        </section>
      </> : <>
        <div className="collection-section-title"><div><h2>Collection variables</h2><p>Values specific to {collection.name}. Reference them with <code>{'{{variable}}'}</code> in requests.</p></div><span className="auto-save-label"><Icon name="check" size={14} />Saved automatically</span></div>
        <div className="variable-hierarchy"><div><Icon name="folder" size={18} /><strong>{collection.name}</strong><span>Higher priority</span></div><Icon name="arrow" size={18} /><button onClick={onGlobals}><Icon name="globe" size={18} /><strong>Global environment</strong><span>Fallback values</span></button></div>
        <p className="variable-rule">Enabled collection values override global values with the same name. Uncheck a collection variable to use its global value. Names are case-sensitive; the last enabled row wins within a scope.</p>
        <KeyValueEditor rows={collection.variables} kind="variable" onChange={variables => onChange({ variables })} />
        <section className="effective-variables-section">
          <div className="collection-section-title"><div><h2>Effective variables <span>{effective.length}</span></h2><p>The values this collection’s requests and generated cURL commands will use.</p></div><button className="text-button" onClick={onGlobals}><Icon name="globe" size={15} />Edit globals</button></div>
          {effective.length ? <div className="effective-variable-table"><table><thead><tr><th>VARIABLE</th><th>RESOLVED VALUE</th><th>SOURCE</th></tr></thead><tbody>{effective.map(entry => {
            let value = '';
            let error = '';
            try { value = interpolate(`{{${entry.name}}}`, effective); } catch (reason) { error = (reason as Error).message; }
            return <tr key={entry.name}><td><code>{`{{${entry.name}}}`}</code></td><td className={error ? 'variable-resolution-error' : ''}><code>{error || (value === '' ? '(empty string)' : value)}</code></td><td><span className={`variable-source source-${entry.scope}`}>{entry.scope === 'collection' ? 'Collection' : 'Global'}</span>{entry.scope === 'collection' && globalNames.has(entry.name) && <small>Overrides global</small>}</td></tr>;
          })}</tbody></table></div> : <div className="no-effective-variables">Add a collection variable above or define a global environment variable.</div>}
        </section>
        <div className="collection-variable-note"><Icon name="lock" size={14} /><span>Values stay on this device and are included in collection and workspace exports. Nested references are resolved using the same hierarchy; missing references and cycles are reported before sending.</span></div>
      </>}
    </div>
  </section>;
}
