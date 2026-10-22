<p align="center">
  <img src="assets/reqora-full.png" alt="Reqora logo" width="280" />
</p>

# Reqora

A free, open-source REST client for building, testing, and debugging HTTP APIs. Reqora aims to offer the REST workflows familiar to Postman and Insomnia through a web application and a cross-platform desktop application.

## Project status

Reqora is in the planning stage. This repository currently contains project documentation, a license, and brand assets. No application code, installation process, or release is available yet. All capabilities below are planned.

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

Implementation has not started. The UI framework, package manager, repository layout, build tooling, and request transport architecture have not been selected. Development and contribution instructions will be added when those choices are made.

## Brand assets

- [Reqora logo with wordmark](assets/reqora-full.png)
- [Reqora symbol](assets/logo-full.png)

## License

Reqora is licensed under the [MIT License](LICENSE).
