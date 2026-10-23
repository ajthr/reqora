import { MAX_SCRIPT_LENGTH } from '../../shared/automation';
import type { ScriptSettings } from '../../shared/automation';

export default function ScriptEditor({ value, onChange, collection = false }: {
  value: Partial<ScriptSettings>; onChange: (changes: Partial<ScriptSettings>) => void; collection?: boolean;
}) {
  return <div className="script-editor">
    <p className="automation-help">{collection ? 'Collection scripts run before the corresponding request scripts.' : 'Pre-request runs before variables are resolved; post-response runs after the response arrives.'} Scripts are synchronous JavaScript with no filesystem or network access.</p>
    <div className="script-columns">
      <label className="field-label">Pre-request script<textarea aria-label={`${collection ? 'Collection ' : ''}Pre-request script`} className="script-code" spellCheck={false} maxLength={MAX_SCRIPT_LENGTH} value={value.preRequestScript || ''} onChange={event => onChange({ preRequestScript: event.target.value })} placeholder={'rq.variables.set("timestamp", Date.now());\nrq.request.setHeader("X-Client", "Reqora");'} /></label>
      <label className="field-label">Post-response script<textarea aria-label={`${collection ? 'Collection ' : ''}Post-response script`} className="script-code" spellCheck={false} maxLength={MAX_SCRIPT_LENGTH} value={value.postResponseScript || ''} onChange={event => onChange({ postResponseScript: event.target.value })} placeholder={'rq.test("Status is 200", () => {\n  rq.expect(rq.response.status).toBe(200);\n});\nrq.variables.set("token", rq.response.json().token);'} /></label>
    </div>
    <details className="script-reference"><summary>Script API and execution order</summary><p><code>rq.variables.get/set/unset</code> uses collection scope by default, or globals for scratch requests. Use <code>rq.globals</code> and <code>rq.collectionVariables</code> for explicit scopes. Run data overrides collection and global values.</p><p><code>rq.data.get("column")</code> reads a data row. <code>rq.iteration</code> is zero-based. Edit <code>rq.request.url</code>, <code>method</code>, <code>body</code>, or use <code>setHeader/removeHeader</code>.</p><p>Post-response: <code>rq.response.status</code>, <code>json()</code>, <code>text()</code>, <code>header("name")</code>, <code>durationMs</code>. Tests use <code>rq.test</code>, <code>rq.assert</code>, and <code>rq.expect(value).toBe/toEqual/toContain/toBeTruthy/toBeDefined/toBeLessThan/toBeGreaterThan</code>. <code>console.log/warn/error</code> appears in results.</p><p>Order: collection pre → request pre → HTTP → collection post → request post → assertions → extractions. Each script is limited to 32 KB, 750 ms of interpreter execution, and 64 MB. Failed scripts stop that request.</p></details>
  </div>;
}
