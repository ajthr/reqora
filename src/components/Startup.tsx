import logo from '../../assets/logo-full.png';
import type { Draft } from '../lib/workspace';
import Icon from './Icon';
import { brandingInteractionProps } from '../lib/branding';

export default function Startup({ requests, onNew, onOpen, onImport, onCollection, onShortcuts }: {
  requests: Draft[];
  onNew: () => void;
  onOpen: (request: Draft) => void;
  onImport: () => void;
  onCollection: () => void;
  onShortcuts: () => void;
}) {
  return <section className="startup-page" aria-label="Startup page">
    <div className="startup-content">
      <div className="startup-brand" {...brandingInteractionProps}><img src={logo} alt="" draggable={false} /><span>reqora<span>.</span></span></div>
      <span className="startup-eyebrow" {...brandingInteractionProps}>YOUR NEXT GREAT API STARTS HERE</span>
      <h1 {...brandingInteractionProps}>A fresh space.<br />Endless possibilities.</h1>
      <p className="startup-intro" {...brandingInteractionProps}>Build a request, explore an endpoint, and make sense of every response. Your workspace is ready when you are.</p>
      <div className="startup-actions">
        <button className="startup-card primary" onClick={onNew}><span className="startup-card-icon"><Icon name="plus" size={23} /></span><strong>New request</strong><span>Start with an endpoint</span><Icon name="arrow" size={18} /></button>
        <button className="startup-card" onClick={onImport}><span className="startup-card-icon"><Icon name="upload" size={22} /></span><strong>Import workspace</strong><span>Bring your requests along</span><Icon name="arrow" size={18} /></button>
        <button className="startup-card" onClick={onCollection}><span className="startup-card-icon"><Icon name="folder" size={22} /></span><strong>New collection</strong><span>Give your ideas a home</span><Icon name="arrow" size={18} /></button>
      </div>
      {requests.length > 0 && <div className="startup-saved"><div className="startup-section-title"><h2>Pick up a request</h2><span>From your saved collections</span></div>{requests.slice(0, 4).map(request => <button key={request.id} className="startup-request" onClick={() => onOpen(request)}><Icon name="file" size={17} /><span className={`method-label method-${request.method.toLowerCase()}`}>{request.method}</span><strong>{request.name}</strong><span className="startup-request-url">{request.url}</span><Icon name="arrow" size={15} /></button>)}</div>}
      <button className="startup-shortcuts" onClick={onShortcuts}><Icon name="terminal" size={15} /><span>A few shortcuts go a long way</span><kbd>?</kbd></button>
    </div>
    <p className="startup-footnote" {...brandingInteractionProps}><Icon name="lock" size={13} /> Free, open source, and at home on your device.</p>
  </section>;
}
