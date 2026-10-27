import type { Draft } from '../lib/workspace';
import type { SchemaSettings } from '../../shared/schema';
import { inspectJsonSchema } from '../../shared/schema';

export default function SchemaEditor({ draft, onChange }: { draft: Draft; onChange: (changes: Partial<Draft>) => void }) {
  const schema: SchemaSettings = draft.schema || { enabled: false, manualResponse: '' };
  const update = (changes: Partial<SchemaSettings>) => onChange({ schema: { ...schema, ...changes } });
  const errors: string[] = [];
  for (const [label, source] of [['Request', schema.manualRequest], ['Response', schema.manualResponse]] as const) if (source?.trim()) {
    try { for (const issue of inspectJsonSchema(JSON.parse(source))) errors.push(`${label} ${issue.path}: ${issue.message}`); }
    catch { errors.push(`${label} schema is not valid JSON.`); }
  }
  const editor = (label: string, field: 'manualRequest' | 'manualResponse') => <label className="field-label">Custom {label.toLowerCase()} JSON schema<textarea className="script-code schema-text" spellCheck={false} maxLength={100_000} placeholder={'{\n  "type": "object",\n  "required": ["id"],\n  "properties": { "id": { "type": "integer" } }\n}'} value={schema[field] || ''} onChange={event => update({ [field]: event.target.value })} /><button type="button" className="text-button" disabled={!schema[field]?.trim()} onClick={() => { try { update({ [field]: JSON.stringify(JSON.parse(schema[field]!), null, 2) }); } catch { /* The inline validation message explains the error. */ } }}>Format {label.toLowerCase()} schema</button></label>;
  return <div className="schema-editor">
    <label className="network-inline"><input type="checkbox" checked={schema.enabled} onChange={event => update({ enabled: event.target.checked })} />Validate JSON bodies against schemas</label>
    {schema.requestSchema !== undefined && <p className="automation-help">An imported OpenAPI request schema checks the outgoing JSON body before HTTP execution. A custom request schema takes priority.</p>}
    {!!schema.responses?.length && <section><h3>Imported OpenAPI responses</h3><div className="schema-response-list">{schema.responses.map((item, index) => <div key={index}><strong>{item.status}</strong><span>{item.mediaType || 'Empty response'}</span></div>)}</div></section>}
    {editor('Request', 'manualRequest')}
    <p className="automation-help">Custom request schemas validate the resolved JSON body before HTTP execution. An invalid body stops the send. Mocks only validate responses because no HTTP request is sent.</p>
    {editor('Response', 'manualResponse')}
    {!!errors.length && <ul className="schema-definition-errors" role="alert">{errors.slice(0, 10).map((error, index) => <li key={index}>{error}</li>)}</ul>}
    {schema.enabled && !schema.manualRequest?.trim() && !schema.manualResponse.trim() && !schema.responses?.length && schema.requestSchema === undefined && <p className="automation-help">Add a custom request/response schema or import an OpenAPI definition to enable a check.</p>}
    <p className="automation-help">Custom schemas take priority over the corresponding imported schema. Each failing field is shown in Tests and collection reports. Supported keywords include type, required, properties, items, enum, const, bounds, allOf, anyOf, oneOf, and local references. Unsupported keywords fail validation. Schemas are JSON definitions; variables are resolved in bodies, not in schema text.</p>
  </div>;
}
