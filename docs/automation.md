# Automation and collection runs

Reqora uses the same execution pipeline in the web UI, Electron, and CLI. Configure a request's **Scripts** and **Tests** tabs, then save the request. A collection's **Scripts** section supplies shared scripts. The response panel's **Tests** view shows checks, extraction results, script errors, and console output.

Execution order:

1. Collection pre-request script.
2. Request pre-request script.
3. Resolve variables and send HTTP.
4. Collection post-response script.
5. Request post-response script.
6. Declarative assertions.
7. Response-to-variable extractions, in configured order.

Pre-request scripts can create variables or edit the outgoing request before interpolation. Post-response scripts inspect the received response. Script request edits affect the current execution, not the saved request. HTTP 4xx/5xx remain inspectable responses; add a status assertion when they should fail a run.

## Scripts

Scripts are synchronous JavaScript running in an isolated QuickJS WebAssembly interpreter inside a disposable worker. They have no Node.js globals, filesystem, network, browser DOM, timers, npm modules, or host module loader. Asynchronous scripts/test callbacks are unsupported. Each script is limited to 32,768 characters, 750 ms of interpreter execution, a 64 MB interpreter heap, and a 3-second worker deadline. Cancellation terminates the worker. A script error prevents later stages of that request; a pre-request error prevents HTTP. A post-response error preserves the received response for inspection.

Pre-request example:

```js
rq.variables.set('timestamp', Date.now());
rq.request.setHeader('X-Client', 'Reqora');
rq.request.setHeader('X-Iteration', String(rq.iteration));
// Raw body modes only; existing JSON validation still applies after interpolation.
rq.request.body = JSON.stringify({ userId: rq.data.get('user_id') ?? 1 });
```

Post-response example:

```js
rq.test('Login succeeded', () => {
  rq.expect(rq.response.status).toBe(200);
  rq.expect(rq.response.json().token).toBeDefined();
});
rq.collectionVariables.set('token', rq.response.json().token);
console.log('Token captured for the next request');
```

| API | Behavior |
| --- | --- |
| `rq.variables.get/has(name)` | Read effective run-data → collection → global values. Returns strings for interpolation. |
| `rq.variables.set/unset(name, value)` | Write collection scope, or global scope for a scratch request. |
| `rq.globals.get/has/set/unset` | Explicit global variable scope. |
| `rq.collectionVariables.get/has/set/unset` | Explicit collection scope; writes require a collection. |
| `rq.data.get(name)`, `rq.data.toObject()` | Read the current data row. JSON retains types; CSV cells are strings. |
| `rq.iteration` | Zero-based data/iteration index. |
| `rq.request` | Current draft fields, including `url`, `method`, `body`, `bodyType`, `params`, and `headers`. |
| `rq.request.setHeader(name, value)`, `removeHeader(name)` | Edit outgoing request headers. |
| `rq.response.status/statusText/url/durationMs/size/encoding` | Inspect response metadata in post-response scripts. |
| `rq.response.json()`, `text()`, `header(name)` | Parse JSON, read the response body string, or find a header case-insensitively. Binary bodies are base64 strings and cannot be parsed with `json()`. |
| `rq.test(name, callback)` | Record a named test. Test failures do not stop subsequent checks. |
| `rq.assert(condition, message)` | Throw if a condition is false. |
| `rq.expect(value)` | Supports `toBe`, `toEqual`, `toContain`, `toBeTruthy`, `toBeDefined`, `toBeLessThan`, `toBeGreaterThan`. |
| `console.log/warn/error` | Record console output alongside results. |

Variable values are strings; objects/arrays are JSON-encoded when assigned. Each script supports up to 100 variable changes and 100 tests. Values are limited to 64 KB, with a total variable context of 1 MB / 1000 values. Logs are capped at 100 entries per script and 2000 characters per entry. Changes made by a script that throws are discarded; changes from earlier successful stages remain available. Ordinary Send applies successful variable changes to the current workspace, including when later assertions fail. Data-row values are read-only overrides and are never saved by interpolation.

Workspaces can contain executable scripts. Review imported scripts as part of reviewing a collection: scripts can change the outgoing URL, headers, body, and variables available to that request. The script interpreter does not expose additional host capabilities.

## Assertions and response extraction

In **Tests**, add checked rules using a source:

- Status code or duration in milliseconds.
- JSON path such as `$.user.id` or `$.items[0].id`.
- A JSON pointer such as `/user/id` or `/a~1b` (for a key named `a/b`).
- A response header name, matched case-insensitively.
- The full response body string.

Assertion operators include equals, not equals, contains, exists, less than, and greater than. Expected values are interpolated and parsed as JSON when valid: `200` means a number, `true` means a boolean, and `"200"` forces a string. Deep equality ignores object property order. Array `contains` checks an item; string `contains` checks a substring. Wildcards, filters, and arbitrary JSONPath expressions are unsupported.

For extraction, supply a variable name and choose Collection or Global. Enable **Fail if the value is missing or extraction fails** for required values. Optional failures are reported without failing the run. Missing values never overwrite existing variables. Empty strings and JSON null are valid extracted values. A scratch request must use Global scope.

Example: extract `$.token` from a login response into collection variable `token`, then use bearer token `{{token}}` on the next request.

## UI collection runner

Open a collection and select **Run collection**, or use its three-dot menu. The runner executes **saved requests**; save open edits first.

- Select requests and reorder them with the up/down buttons.
- Choose iterations, a delay between requests, and whether to stop after the first failure.
- Paste JSON/CSV data or drop a data file into the data area.
- Run, inspect progress/checks/logs, cancel, and export the JSON report.
- Runs use an isolated workspace snapshot. Variable changes flow to later requests in that run. **Save variable changes to workspace** optionally applies changes from completed executions when the run finishes or is cancelled. Closing the runner cancels it and does not save variable changes. Acquired/refreshed OAuth tokens are always applied to their matching workspace owner so rotating refresh tokens are retained, including completed refreshes before cancellation.

One dataset pass is one execution of the selected requests for every row. For example, 3 requests × 2 rows × 2 iterations = 12 request executions. With no data, each iteration runs the selected requests once. Each run supports up to 1000 executions, 1000 data rows, 100 data columns, and 2 MB of input data. Runs are sequential. Cancellation stops active HTTP or script execution; completed results remain available while the runner stays open.

JSON data:

```json
[
  { "user_id": 1, "expected_status": 200 },
  { "user_id": 2, "expected_status": 200 }
]
```

CSV data (quoted commas, escaped quotes, CRLF, multiline cells, and empty cells are supported):

```csv
user_id,expected_status
1,200
2,200
```

Use `{{user_id}}` in the request and `{{expected_status}}` in an assertion. Data values take priority over collection and global variables. Console/check detail storage is capped at 8 MB per run; summary counts and execution outcomes remain available if details are truncated. Reports omit full response bodies, but variable changes, logs, names, and URLs can contain sensitive values. Keep exported reports private as appropriate.

## CLI runner

From source, use Node.js 24 and installed dependencies:

```sh
npm ci
npm run cli -- --help
npm run cli -- run workspace.json --collection "My API" \
  --data cases.csv --iterations 2 --delay 100 --bail \
  --report results.json --junit results.xml
```

`workspace.json` is a Reqora workspace/collection/request export. A collection selector is optional when the file contains exactly one collection. Use an ID or unique name. Select/reorder requests with repeated `--request NAME_OR_ID` flags.

Additional options:

```sh
# Override data/collection/global values for this run only:
npm run cli -- run workspace.json --var base_url=http://localhost:3000 --var user_id=42

# Attach files referenced by exported metadata, within an explicitly allowed directory:
npm run cli -- run workspace.json --files ./fixtures

# Persist variable changes and acquired/refreshed OAuth tokens to a separate workspace file:
npm run cli -- run workspace.json --save-variables workspace-after-run.json
```

`--files` resolves only validated basenames within the directory and rejects symlinks resolving outside it. File bytes are limited by the same 10 MB request-body limit. The CLI does not change the input workspace unless you explicitly choose it as an output path. Reports use restrictive file permissions where supported. `--quiet` suppresses per-request progress. Ctrl+C cancels the run; configured report files still record completed results and cancellation.

All request/collection [authentication helpers](authentication.md) work in the runner and CLI. Interactive OAuth authorization is completed in the UI before exporting; client credentials and refresh execute automatically. JSON reports omit internal OAuth token-update records. Use the workspace written by `--save-variables` for later runs when your provider rotates refresh tokens.

Exit codes: **0** all executed requests/checks passed; **1** a request, script, assertion, or required extraction failed; **2** invalid configuration/input/report output; **130** cancelled.

Installed Linux/macOS bundles provide `~/.local/bin/reqora-run`. Windows provides `%LOCALAPPDATA%\Programs\Reqora\reqora-run.cmd`. Web/Both installations use their bundled Node runtime; Desktop-only installations use Electron's Node mode. No separate Node installation is needed for these installed launchers.

## API

`POST /api/run-request` uses the same origin/content-type protections and 16 MB JSON payload limit as `/api/execute`. Send `{ request, globals, collection?, data?, files?, iteration? }`: `request` is a Reqora draft; variables use the workspace entry format; `files` maps attachment IDs to base64 data. The response includes `{ response?, error?, passed, tests, logs, changes, authUpdates? }`; internal `authUpdates` contain refreshed tokens and configuration guards for the owning request/collection and must not be included in exported run reports. HTTP status reflects transport/input validity; a valid execution with failed checks returns HTTP 200 with `passed: false`. The legacy `/api/execute` endpoint still accepts already-prepared HTTP requests, including active `auth`, and does not run scripts or persist refreshed tokens. OAuth UI actions use `POST /api/auth`; `GET /api/auth/callback` accepts state-validated provider callbacks, and `POST /api/auth/preview` generates an OAuth 1 header without sending the resource request.
