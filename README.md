<p align="center">
  <img src="assets/reqora-full.png" alt="Reqora logo" width="280" />
</p>

# Reqora

A free, open-source REST client for building, testing, and debugging HTTP APIs. Reqora aims to offer the REST workflows familiar to Postman and Insomnia through a web application and a cross-platform desktop application.

## Project status

Reqora has a minimal application scaffold: a shared React and TypeScript UI built with Vite, an Electron desktop entry point, and a Docker image for the web app. Both interfaces currently display a blank white page. REST functionality and distributable desktop installers have not been implemented. All REST capabilities below are planned.

## Platforms and technology

- **Web:** A browser-based REST client.
- **Desktop:** An Electron application for Windows, macOS, and Linux.
- **Shared UI:** A common interface and reusable application logic written in TypeScript for both platforms.

The initial scope is REST over HTTP and HTTPS. GraphQL, WebSocket, gRPC, and other protocol-specific tooling are outside the initial scope.

## Planned REST capabilities

The goal is comprehensive coverage of the REST workflows available in established clients. This feature outline is a planning baseline; it does not claim implemented feature parity.

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
- Clear handling of browser restrictions, including CORS and access to local services. Browser request execution and any companion transport remain design decisions.

## Development

### Run the web app with Docker

Install Docker with the Compose plugin, then run from the repository root:

```sh
docker compose up --build -d
```

Open [http://localhost:5173](http://localhost:5173) to see the blank page. The first build downloads dependencies and requires internet access. Docker serves the compiled UI through Nginx; rebuild after source changes.

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

Open [http://localhost:5173](http://localhost:5173). Vite reloads the shared UI when source files change.

### Run the Electron desktop app

On Windows, macOS, or Linux with a graphical desktop, install dependencies as above and run:

```sh
npm run desktop
```

This builds the shared UI and Electron main process, then opens a blank native window. Electron runs on the host; the Docker container serves the web app. Native packaging and installers will be added later.

### Check and build

```sh
npm run typecheck
npm run build
```

Web output is written to `dist/`; compiled Electron code is written to `dist-electron/`. The existing logo is used for the web favicon and desktop window icon where supported.

### Project layout

```text
assets/                  Existing brand assets
src/                     Shared React and TypeScript UI
electron/main.ts         Electron window and app lifecycle
docker/nginx.conf        Web container configuration
Dockerfile               Web build and runtime image
compose.yaml             Local Docker service
```

The request transport architecture remains a future design decision.

## Brand assets

- [Reqora logo with wordmark](assets/reqora-full.png)
- [Reqora symbol](assets/logo-full.png)

## License

Reqora is licensed under the [MIT License](LICENSE).
