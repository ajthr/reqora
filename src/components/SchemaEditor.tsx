import type { Draft } from '../lib/workspace';
import type { SchemaSettings } from '../../shared/schema';

export default function SchemaEditor({ draft, onChange }: { draft: Draft; onChange: (changes: Partial<Draft>) => void }) {
  const schema: SchemaSettings = draft.schema || { enabled: false, manualResponse: '' };
  const update = (changes: Partial<SchemaSettings>) => onChange({ schema: { ...schema, ...changes } });
  let error = '';
  if (schema.manualResponse.trim()) try { JSON.parse(schema.manualResponse); } catch { error = 'Enter a valid JSON schema before sending.'; }
  return <div className="schema-editor">
    <label className="network-inline"><input type="checkbox" checked={schema.enabled} onChange={event => update({ enabled: event.target.checked })} />Validate JSON bodies against schemas</label>
    {!!schema.requestSchema && <p className="automation-help">An imported OpenAPI request schema checks the outgoing JSON body before HTTP execution.</p>}
    {!!schema.responses?.length && <section><h3>Imported OpenAPI responses</h3><div className="schema-response-list">{schema.responses.map((item, index) => <div key={index}><strong>{item.status}</strong><span>{item.mediaType || 'Empty response'}</span></div>)}</div></section>}
    <label className="field-label">Custom response JSON schema<textarea className="script-code schema-text" spellCheck={false} maxLength={100_000} placeholder={'{\n  "type": "object",\n  "required": ["id"],\n  "properties": { "id": { "type": "integer" } }\n}'} value={schema.manualResponse} onChange={event => update({ manualResponse: event.target.value })} /></label>
    {error && <p className="error-text" role="alert">{error}</p>}
    {schema.enabled && !schema.manualResponse.trim() && !schema.responses?.length && schema.requestSchema === undefined && <p className="automation-help">Add a custom response schema or import an OpenAPI definition to enable a check.</p>}
    <p className="automation-help">A custom schema takes priority over imported response schemas. Results appear in the response Tests view and collection reports. Supported keywords include type, required, properties, items, enum, const, bounds, allOf, anyOf, oneOf, and local references. Unsupported keywords fail validation.</p>
  </div>;
}
