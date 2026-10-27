<p align="center">
  <img src="assets/reqora-full.png" alt="Reqora logo" width="280" />
</p>

<p align="center"><a href="https://ajthr.github.io/reqora/">Download Reqora</a> · <a href="https://github.com/ajthr/reqora/releases">Release notes</a></p>

# Reqora

A free, open-source REST client for building, testing, and debugging HTTP APIs. Reqora aims to offer the REST workflows familiar to Postman and Insomnia through a web application and a cross-platform desktop application.

## Project status

Reqora now has its first working REST workflow: a shared React and TypeScript workspace with a Node.js request engine, available through the browser and Electron. Docker runs the web UI and backend together. The project is early in development; the long-term feature list below is a roadmap, not a claim of feature parity. Installer build scripts now cover desktop-only, web-only, and combined installations for Windows, Linux, and macOS.

## Available now

- A responsive workspace with request tabs, editable request names, and light/dark themes.
- A startup page when no request tabs are open, with quick actions and saved requests. Closing the last tab returns here without creating another request.
- Shared File, View, Request, and Help menus and an interactive status bar in both web and Electron. Electron's native application menu is removed.
- GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS requests over HTTP and HTTPS.
- Query parameters, request headers, JSON/XML/text bodies, structured URL-encoded forms, multipart text/file uploads, and binary file bodies.
- Basic, bearer, API key, OAuth 2.0 (PKCE/client credentials/refresh), OAuth 1.0a, Digest, and AWS Signature V4 helpers, with inherited collection authentication.
- Named environments, base variables, and per-collection variables with `{{variable}}` substitution in URLs, parameters, headers, authentication, and bodies. Collection values take priority over the active environment and base variables, including in generated cURL.
- Multiple local workspaces and environments with creation, renaming, duplication, switching, deletion, and single/all-workspace and environment JSON import/export.
- Collection overview pages with descriptions, request lists, variable editors, and a resolved-value table showing the source of each effective variable.
- A server-side request engine with cancellation, configurable timeouts, and optional redirect following.
- A persistent workspace cookie jar with an editor, per-request cookie control, HTTP(S) proxy settings, custom CA certificates, and client certificates for mTLS.
- Response status, elapsed time, decoded body size, headers, cookies, searchable body with match navigation, collapsible JSON trees and path filtering, comparison against saved examples, safe HTML/text/JSON and image previews, request/response details, and downloads. Binary responses can be downloaded.
- Named collections, nested folders, saved requests, drag-and-drop/manual ordering, folder-scoped runs and exports, search, and the last 100 request attempts in local history.
- Three-dot menus on requests and collections for renaming, duplication, export, and deletion; request menus also support moving between collections and copying cURL.
- Shared in-app dialogs for editing and destructive actions, with keyboard focus containment, Escape dismissal, and focus restoration.
- Reqora workspace JSON import/export; Postman collection/environment, Insomnia export, OpenAPI 3 JSON with request/response schemas, and cURL command import; POSIX-shell cURL command generation.
- Pre-request/post-response scripts at request and collection scope, response assertions, response-to-variable extraction, JSON schema checks, and local mock responses.
- A sequential collection runner following saved root/folder request order, with JSON/CSV datasets, iterations, delay, cancellation, and optional variable persistence.
- A CLI runner with JSON/JUnit reports and CI exit codes, using the same pipeline as the UI.
- `Ctrl/Cmd + Enter` to send and `Ctrl/Cmd + S` to save.

Use the sidebar rail to switch between collections and history. Those views are not duplicated as workspace tabs. Text and editor sizes have been increased throughout the interface for readability.

Open **Get a post** in the sample collection and select **Send** to try the client. The sample requests use JSONPlaceholder and require internet access. Edit **Environments** to change the shared `base_url`, or override it for an individual collection.

### Collections, folders, and variable hierarchy

Select a collection's name in the sidebar to open its overview. Add folders from the collection menu, then use a folder's menu to add subfolders, rename or move it under a different parent, duplicate its subtree, export it, or run its requests. Collections support up to 1000 folders and 20 levels; cycles and missing parents are rejected. Deleting a folder promotes its requests and immediate child folders to its parent (or collection root), keeping all requests and descendants. Folder exports include descendants, collection configuration, environments, and saved examples. Duplicates receive independent folder/request/example IDs while retaining same-device attachment references.

Drag requests into folders or across collections; moving across collections changes variable/authentication inheritance to the destination. Drag folders to reorder siblings, or use **Rename or move folder** to choose a different parent. Menu actions provide keyboard-accessible move controls. The sidebar and collection overview search include full folder paths. A collection run follows root requests, then folder requests and descendants in sidebar order. **Run folder** preselects that subtree's requests; you can adjust the selection in the runner.

Save a received response as a named example from the response panel, then inspect it on the request's Examples tab. **Use as mock** copies a complete example into the request's default mock response. The collection arrow independently expands or collapses requests. Its overview provides an automatically saved description and a searchable request list. **Variables** edits collection values and shows effective values with their source. The collection's menu also opens its overview or variables directly.

Variable priority, from highest to lowest, is **collection → active environment → base variables**. Unsaved requests created within a collection use that collection's variables; scratch requests use globals. Moving a saved request changes its scope to the destination collection. History replays retain the originating collection context when available.

- Only enabled, non-empty variable names participate. An unchecked environment variable falls back to the base value. An unchecked collection variable falls back to the active environment or base value.
- An enabled empty string intentionally overrides values in lower priority scopes.
- Names are trimmed and case-sensitive. If a name repeats in a scope, the last enabled row wins.
- Values can reference other variables, for example base `base_url = https://{{host}}/v1` with a collection-specific `host` override. Resolution uses the final effective scope and reports missing references, cycles, excessive nesting, or excessive expanded values (1 MB in URLs/headers and 10 MB in body values).
- Workspace/request/collection exports preserve collection variables and descriptions. Duplicating a collection copies its variables independently. Older workspace files migrate with empty collection variables and descriptions.

Close collection and request tabs to return to the startup page. Closing an overview preserves its automatically saved settings.

Collections, saved request credentials, cookies, history, and environment values are stored in local browser storage without encryption. Workspace exports include those values. Multiple named workspaces are stored locally; use the Workspaces button to create, rename, duplicate, switch, or delete them. New workspaces start empty. Web and desktop maintain separate data; use export/import to move a workspace between them. Save requests you want to keep before closing their tabs.

To import, open **Import**, choose or drop a Reqora, Postman, Insomnia, or OpenAPI JSON export, or paste JSON or a cURL command. Review the detected format and counts before confirming. Imports accept files up to 25 MB. Workspace and collection imports create and open a new workspace by default. You can explicitly choose **Replace active workspace** for a single-workspace import; other workspaces are kept. Request and collection exports use the same workspace format and include environment values so variable references remain usable. Postman and Insomnia nested and empty folders are preserved, subject to the 20-level / 1000-folder limits. External formats are converted to Reqora’s supported REST fields; advanced scripts, file attachments, and unsupported authentication settings are not imported. OpenAPI YAML must be converted to JSON first. cURL import accepts common method, header, body, URL, Basic auth, redirect, and timeout options and reports unsupported options.

### Workspace and environment transfers

Use **Workspaces** or **File → Manage workspaces** to manage up to 100 local workspaces. Each workspace has its own collections, saved requests and response examples, base variables, named environments, active environment, cookies, and history. Switching, creating, duplicating, and importing workspaces warns before discarding unsaved request tabs. Finish active requests and collection runs before changing workspaces or environments. The last workspace and its selected environment are restored on startup.

- **Export** beside a workspace exports that saved workspace with its name and environments. These files remain compatible with the CLI runner and older Reqora workspace readers.
- **Export all workspaces** creates a Reqora backup of every workspace and the active selection. Importing a backup adds new workspace copies and opens the imported active workspace. Existing data is retained; duplicate names receive numbered suffixes and workspace IDs are regenerated.
- In **Environments**, create, rename, duplicate, delete, and select environments. **Export selected** exports one environment; **Export all and base variables** includes every environment, base variables, and the active environment selection.
- **Import environments** accepts Reqora environment files and Postman environment exports. It adds copies to the current workspace with fresh IDs and numbered names where needed. Existing collections, cookies, history, and environments stay available. Imported base variables fill missing names; existing base values win on name conflicts. You can keep the current environment selected by unchecking **Use the imported active environment**.

Exports contain saved data, not unsaved request tabs. They can include credentials, cookies, certificates, and private variable values. Files are not encrypted. Attachments retain metadata and same-device references; file bytes are not bundled, so reattach files after moving to a different browser or device. Keep export files private if they contain credentials. Unreadable local storage is left untouched and reported; export session work before closing if local saving is unavailable.

### API schemas and mocks

Open a request's **Schema** tab to enable JSON validation. Paste custom request and/or response JSON schemas, or import an OpenAPI 3 JSON document to attach its operation schemas. Each custom schema takes priority over the corresponding imported schema. Schema definitions are checked before execution; request body mismatches stop the HTTP call. Request failures show their checks even when no response was received. Response mismatches appear as failed checks in **Tests**, collection runs, and CLI reports, with up to 30 individual field paths and messages. Imported schemas resolve local `#/components/schemas/...` references; standalone custom schemas can use local `$defs`/`definitions` references. Schemas themselves are not interpolated; request body variables resolve before validation.

Use **Mock** to return a configured status, headers, and body without contacting the URL. Keep a default response and up to 20 named scenarios per request, with an independently selected scenario. Add, rename, remove, and switch scenarios in the editor. Copy a saved example into the selected scenario, or choose **Use as mock** on an example to populate the default. Truncated examples and bodies over 100,000 characters cannot become mocks; transport/compression headers are omitted when copying decoded example bodies.

Each scenario can delay its response (0–60,000 ms), simulate a network/timeout failure, or return literal base64 binary bytes. Delays respect cancellation and the request's timeout. Text bodies and header values support variables; binary bytes remain literal. HEAD, informational statuses, 204, 205, and 304 return empty bodies. Mock sends still run pre-request scripts; returned responses run post-response scripts, checks, schema validation, and extraction. Failures return no response and skip response processing. A MOCK badge and scenario name identify UI results and collection/CLI report records. Save mock edits before running collections or exporting. Mocks are request-local simulations and do not expose a hosted mock server endpoint.

Schema validation supports types, required/properties/items, additional properties, enum/const, length/item/property/number bounds, multipleOf, allOf/anyOf/oneOf, common string formats, and local references. Unsupported keywords and external references fail the check explicitly. Manual schemas and mock bodies are size-limited in the editor.

### Inspect and compare responses

- **Body** provides Pretty/Raw views and literal, case-insensitive search. Previous/Next navigates the highlighted matches. Rendering and search cover the first 100,000 characters / 2,000 lines, with up to 5,000 navigable matches. Downloads retain the full response within the engine limit.
- **Tree** provides collapsible JSON objects/arrays, value copying, and JSON pointer copying. Filter with paths such as `$.users[0].id` or `/users/0/id`; wildcard and recursive JSONPath expressions are not supported. Missing paths and invalid JSON are explained inline. Large branches load 100 children at a time, with a 30-level display limit.
- **Compare** compares the current response with a saved response example from the same request. Status, reason phrase, headers, and bodies are checked. JSON comparison ignores formatting and object key order; text and binary bodies use exact comparison. Comparison is bounded to 100 differences, 10,000 nodes, and 40 levels, and displayed values to 2,000 characters. A truncated example compares only status and headers, with an explicit notice.
- **Preview** supports JSON/text, sandboxed HTML, and common raster images. HTML scripts, forms, and external resources are blocked. **Details** uses the executed method and resolved URL, so editing a request after sending does not change the displayed execution details.
- **Tests** shows schema field errors, assertions, extraction results, and script logs. Failed assertions include bounded expected/actual values; JSON and JUnit reports retain those details. Extra operators include type, length, missing-value checks, and inclusive numeric bounds.

### Request bodies

Open a request's **Body** tab and select:

- **JSON**, **XML**, or **Text** for raw content. JSON is validated after variable substitution and has a format action. XML and text are sent as written. Set a custom `Content-Type` in Headers if needed.
- **URL encoded** for an editable key/value table. Only checked, named rows are sent; duplicate keys and empty values are preserved. Values are interpolated before encoding, so `&`, `+`, and Unicode stay inside their field values. Older raw URL-encoded bodies migrate into this table.
- **Multipart** for mixed text/file fields. Choose Text or File per row; repeat a key for multiple files or values. The engine generates the multipart boundary and overrides any manually supplied `Content-Type` for this mode.
- **Binary file** to send a file's exact bytes. The file's media type is the default `Content-Type`; Headers can override it. Empty files are supported.

Attach files by dragging them into the in-app file area or focusing it and pasting a file when the clipboard provides file data. File areas support replacing/removing attachments without native file dialogs. A missing attachment is flagged and must be reattached before sending.

Attachments are stored separately in IndexedDB on the current device, outside local-storage workspace JSON. If persistent file storage is unavailable, the UI reports that the attachment is available for the current session only. Saving, duplication, history replay, and same-device import/export retain file references. Exports include **file metadata, not file bytes**; reattach files when moving a workspace between browsers/devices or between web and desktop. Clear the application's site storage to remove stored attachments. Files are not encrypted by Reqora.

Global/collection variables apply to raw content and form field names/text values. File bytes and filenames remain literal. GET and HEAD ignore configured bodies and attachments while retaining them for later method changes. The combined outbound body limit is **10 MB**, including multipart boundaries; the JSON transport limit is **16 MB**. cURL exports use local filenames (`--form` / `--data-binary`), so place the named files in the directory where you run the command.

## Automation

See [scripts, assertions, extraction, collection runs, and CLI usage](docs/automation.md) for setup and examples. Run `npm run cli -- --help` for CLI options.

## Authentication

Use a request's **Auth** tab, or a collection's **Auth** section to share credentials. New requests **Inherit from collection**; choose an explicit helper to override it, or **No authentication** to disable inheritance. Existing saved authentication choices are preserved. Credential values support the same variable hierarchy as the request, including data-row overrides during runs.

OAuth helpers can obtain tokens through a browser authorization page or client credentials, and refresh them automatically. Collection runs and the CLI use the same signing/token engine. See [authentication setup and supported flows](docs/authentication.md), including redirect URI registration and CLI token persistence.

## Cookies, proxies, and TLS

Open **Cookie jar** from the toolbar or sidebar to add, edit, filter, delete, or clear cookies. Each request's **Settings** tab controls use of the jar, proxy mode, custom CA, and client certificate. See [network configuration](docs/network.md) for cookie matching, persistence, proxy environment variables, certificate setup, and CLI behavior.

## Platforms and technology

- **Web:** A browser-based REST client.
- **Desktop:** An Electron application for Windows, macOS, and Linux.
- **Shared UI:** A common interface and reusable application logic written in TypeScript for both platforms.

The initial scope is REST over HTTP and HTTPS. GraphQL, WebSocket, gRPC, and other protocol-specific tooling are outside the initial scope.

## Planned REST capabilities

The goal is comprehensive coverage of the REST workflows available in established clients. This outline includes both the initial features above and work still to come, such as OpenAPI/third-party collection imports.

### Compose and send requests

- Standard and custom HTTP methods, URL editing, path variables, and query parameters.
- Headers, cookies, and configurable request defaults.
- JSON, XML, text, URL-encoded forms, multipart forms, binary bodies, and file uploads.
- Authentication including Basic, Digest, bearer tokens, API keys, OAuth 1.0, OAuth 2.0, and AWS Signature Version 4.
- Configurable timeouts, redirects, proxies, TLS verification, and client certificates.
- Generate client code snippets and import or export cURL commands.

### Inspect responses

- Status codes, timing, response size, headers, and cookies.
- Formatted, raw, and preview views with syntax highlighting and search.
- Save response bodies, download files, and retain request and response history.
- Inspect request execution details and troubleshoot HTTP failures.

### Organize API work

- Workspaces, collections, folders, saved requests, tabs, and examples.
- Environment variables, scoped variables, reusable values, and sensitive-value handling.
- Collection-level configuration and inherited authentication.
- Search, duplicate, reorder, and organize requests and collections.
- Local persistence, portable exports, and shareable collection files.

### Automate and test

- Pre-request and post-response scripts.
- Assertions for status, headers, response bodies, schemas, and performance.
- Extract response values and chain requests.
- Collection runs with iterations, input data, execution controls, and test reports.
- Command-line execution for automated REST tests and CI workflows.

### Import, export, and document

- Import and export REST collections and environments, including compatible Postman and Insomnia formats.
- Import OpenAPI descriptions and generate requests from API definitions.
- Document endpoints with descriptions, request examples, and sample responses.
- REST mock responses and validation against API schemas.

### Work comfortably across platforms

- Keyboard shortcuts, accessible navigation, and light and dark themes.
- A consistent editing and testing experience across the web and desktop apps.
- Access to local services and HTTP execution outside browser CORS restrictions, with additional transport controls planned.

## Installation packages

See [installation and release builds](docs/installation.md) for Windows setup wizards and Linux/macOS terminal installers. All three modes—desktop only, web UI only, or both—include their required runtimes. Build locally with `npm run package`; packages are generated into `release/`. Pushing an unpublished package version to **main** runs the **Release from main** workflow: it tests and packages all six platform/architecture targets, verifies checksums, creates the version tag on the tested commit, and publishes the GitHub Release after every job succeeds. `0.1.0-beta.1` is prepared as a prerelease. Development on **develop** and pull requests run CI without publication. See [release procedure](docs/releasing.md) and [beta notes](docs/releases/v0.1.0-beta.1.md).

## Development

### Run the web app with Docker

Install Docker with the Compose plugin, then run from the repository root:

```sh
docker compose up --build -d
```

Open [http://localhost:5173](http://localhost:5173). The first build downloads dependencies and requires internet access. Nginx serves the compiled UI and forwards `/api/` requests to the Node.js backend. The web port is bound to localhost; the backend is internal to the Compose network. Rebuild after source changes.

When calling an API running on your host from Docker, use `http://host.docker.internal:PORT` instead of `localhost`; within the request engine, `localhost` refers to its container. Your host API must listen on an interface reachable from Docker.

To use a different host port:

```sh
REQORA_PORT=8080 docker compose up --build -d
```

To stop the app:

```sh
docker compose down
```

### Local web development

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). This command starts Vite on port 5173 and the Node.js backend on port 3001 with file watching. Vite proxies `/api/` to the backend, so outbound API calls are executed outside browser CORS restrictions. Stop the Docker stack first if it is already using port 5173.

The processes can also run separately with `npm run dev:web` and `npm run dev:api` in two terminals. For a built web preview, use `npm run preview` alongside `npm run start:api`.

### Run the Electron desktop app

On Windows, macOS, or Linux with a graphical desktop, install dependencies as above and run:

```sh
npm run desktop
```

This builds the shared UI and Electron main process, then opens the REST workspace. Electron starts its own loopback request engine on port 43129 and does not require Docker or a separate backend. A stable local origin preserves desktop data across launches, and a second launch focuses the existing window. Use `npm run package:desktop` to produce an installation package; see [installation instructions](docs/installation.md) for all modes.

### Check and build

```sh
npm run typecheck
npm test
npm run build
```

Web output is written to `dist/`; compiled Electron code and its shared backend modules are written to `dist-electron/`. The existing logo is used for the web favicon, navigation, and desktop window icon where supported. The Docker web build also runs type checks and tests.

### Backend API

- `GET /api/health` returns the request engine's health.
- `POST /api/run-request` runs the shared automation pipeline, returning response/checks/logs/variable changes; see [automation API](docs/automation.md#api).
- `POST /api/execute` accepts JSON containing `url`, `method`, `headers` (an array of `{ name, value }`), optional `body` (text or a typed binary/multipart body), `timeoutMs`, and `followRedirects`.
- Responses contain the upstream status, status text, final URL, headers, body, encoding (`utf8` or `base64`), duration, and byte size. Upstream 4xx/5xx responses remain inspectable; transport and validation errors use a JSON `error` field.

The engine verifies TLS certificates, supports timeouts from 100 ms to 60 seconds, limits outbound request bodies to 10 MB and JSON execution payloads to 16 MB (to accommodate base64 file transport), and limits decoded response bodies to 5 MB. Response previews show up to 100 KB / 2,000 lines; downloads include the full response within the engine limit. Request framing headers such as `Host` and `Content-Length` are managed by the engine. See [network configuration](docs/network.md) for cookies, proxies, and certificates.

This is currently a local, single-user application. Accounts, cloud synchronization, encrypted credential storage, and multi-user hosting are outside this increment.

### Project layout

```text
assets/                  Existing brand assets
src/                     Shared React and TypeScript UI
electron/main.ts         Electron window and app lifecycle
server/                  Node.js server and shared HTTP request engine
shared/                  Shared request/response types and body limits
scripts/dev.mjs          Web/backend development process launcher
scripts/package.mjs      Native installation package builder
cli/                     Collection CLI runner
server/pipeline.ts       Shared request automation execution
shared/runner.ts         Ordered collection and data-driven run orchestration
packaging/               Windows wizard, Unix installers, web launcher, icons
docs/installation.md     Installation, upgrades, and release build guide
.github/workflows/       Native installer build automation
tests/                   Request engine and workspace behavior tests
docker/nginx.conf        Web container configuration
Dockerfile               Web build and runtime image
compose.yaml             Local Docker service
```

Both web and desktop use `server/execute.ts` for HTTP execution. Collections and history remain on the client; they are not stored on the backend.

## Brand assets

- [Reqora logo with wordmark](assets/reqora-full.png)
- [Reqora symbol](assets/logo-full.png)

## License

Reqora is licensed under the [MIT License](LICENSE).
