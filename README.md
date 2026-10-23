<p align="center">
  <img src="assets/reqora-full.png" alt="Reqora logo" width="280" />
</p>

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
- Global environment and per-collection variables with `{{variable}}` substitution in URLs, parameters, headers, authentication, and bodies. Collection values take priority over globals, including in generated cURL.
- Collection overview pages with descriptions, request lists, variable editors, and a resolved-value table showing the source of each effective variable.
- A server-side request engine with cancellation, configurable timeouts, and optional redirect following.
- Response status, elapsed time, decoded body size, headers, formatted JSON, raw text, copying, and downloads. Binary responses can be downloaded.
- Named collections, saved requests, search, and the last 100 request attempts in local history.
- Three-dot menus on requests and collections for renaming, duplication, export, and deletion; request menus also support moving between collections and copying cURL.
- Shared in-app dialogs for editing and destructive actions, with keyboard focus containment, Escape dismissal, and focus restoration.
- Reqora workspace JSON import/export and POSIX-shell cURL command generation.
- Pre-request/post-response scripts at request and collection scope, response assertions, and response-to-variable extraction.
- A sequential collection runner with JSON/CSV datasets, iterations, delay, cancellation, and optional variable persistence.
- A CLI runner with JSON/JUnit reports and CI exit codes, using the same pipeline as the UI.
- `Ctrl/Cmd + Enter` to send and `Ctrl/Cmd + S` to save.

Use the sidebar rail to switch between collections and history. Those views are not duplicated as workspace tabs. Text and editor sizes have been increased throughout the interface for readability.

Open **Get a post** in the sample collection and select **Send** to try the client. The sample requests use JSONPlaceholder and require internet access. Edit **Global variables** to change the shared `base_url`, or override it for an individual collection.

### Collections and variable hierarchy

Select a collection's name in the sidebar to open its overview. The arrow beside the name independently expands or collapses its requests. The overview provides an automatically saved description and a searchable request list. Its **Variables** section edits collection values and shows effective values with their source. The collection's three-dot menu also opens its overview or variables directly.

Variable priority, from highest to lowest, is **collection → global environment**. Unsaved requests created within a collection use that collection's variables; scratch requests use globals. Moving a saved request changes its scope to the destination collection. History replays retain the originating collection context when available.

- Only enabled, non-empty variable names participate. An unchecked collection variable falls back to the global value.
- An enabled empty string intentionally overrides the global value.
- Names are trimmed and case-sensitive. If a name repeats in a scope, the last enabled row wins.
- Values can reference other variables, for example global `base_url = https://{{host}}/v1` with a collection-specific `host` override. Resolution uses the final effective scope and reports missing references, cycles, excessive nesting, or excessive expanded values (1 MB in URLs/headers and 10 MB in body values).
- Workspace/request/collection exports preserve collection variables and descriptions. Duplicating a collection copies its variables independently. Older workspace files migrate with empty collection variables and descriptions.

Close collection and request tabs to return to the startup page. Closing an overview preserves its automatically saved settings.

Collections, saved request credentials, history, and environment values are stored in local browser storage without encryption. Workspace exports include those values. Web and desktop maintain separate local workspaces; use export/import to move between them. Save requests you want to keep before closing their tabs.

To import a workspace, open **Import**, drag a Reqora JSON export into the custom dialog or paste its contents, then review and confirm replacement. Request and collection exports use the same workspace format and include environment values so variable references remain usable. Imports replace the saved workspace after confirmation; they do not merge into it.

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

## Platforms and technology

- **Web:** A browser-based REST client.
- **Desktop:** An Electron application for Windows, macOS, and Linux.
- **Shared UI:** A common interface and reusable application logic written in TypeScript for both platforms.

The initial scope is REST over HTTP and HTTPS. GraphQL, WebSocket, gRPC, and other protocol-specific tooling are outside the initial scope.

## Planned REST capabilities

The goal is comprehensive coverage of the REST workflows available in established clients. This outline includes both the initial features above and work still to come, such as cookie management and OpenAPI/third-party collection imports.

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

See [installation and release builds](docs/installation.md) for Windows setup wizards and Linux/macOS terminal installers. All three modes—desktop only, web UI only, or both—include their required runtimes. Build with `npm run package` or use the **Build installers** GitHub Actions workflow. Packages are generated into `release/`; no hosted release is published automatically.

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

The initial engine verifies TLS certificates, supports timeouts from 100 ms to 60 seconds, limits outbound request bodies to 10 MB and JSON execution payloads to 16 MB (to accommodate base64 file transport), and limits decoded response bodies to 5 MB. Response previews show up to 100 KB / 2,000 lines; downloads include the full response within the engine limit. Request framing headers such as `Host` and `Content-Length` are managed by the engine. Cookie headers can be set manually, but a persistent cookie jar has not been implemented.

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
