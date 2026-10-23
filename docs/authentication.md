# Authentication

The shared web/Electron UI and CLI use one backend authentication engine. Open **Auth** on a request or collection overview. Collection settings save automatically; save request changes before running/exporting a collection.

## Collection inheritance and variables

New requests default to **Inherit from collection**. Scratch requests without a collection resolve to no authentication. A request's explicit helper overrides the collection, and **No authentication** disables inheritance. Legacy imports retain their existing authentication choice. Moving a saved request changes the collection from which it inherits.

Credential strings support `{{variable}}`. Priority is **run data / CLI overrides → collection variables → global variables**. Only the active helper is resolved: an unused credential field cannot cause a missing-variable error. Collection authentication uses the executing request's variable scope. Exports/duplicates preserve authentication settings.

## Helpers

| Helper | Configuration and behavior |
| --- | --- |
| Basic | Username and password; generates an Authorization header. |
| Bearer | Token; generates `Authorization: Bearer …`. |
| API key | Key name/value, placed in a header or query parameter. Replaces existing instances of that key. Engine-managed headers such as Host are rejected. |
| Digest | Username/password. Negotiates WWW-Authenticate challenges with MD5, SHA-256, SHA-512-256, and session variants; supports `auth`, `auth-int`, opaque, UTF-8, and userhash. Retries a stale nonce once. |
| OAuth 1.0a | Consumer key/secret and access token/secret. Signs using HMAC-SHA1, HMAC-SHA256, RSA-SHA1 (unencrypted PEM private key), or PLAINTEXT (HTTPS except loopback). Optional realm. Includes repeated query and URL-encoded form fields in signatures. |
| AWS Signature V4 | Access key ID, secret key, region, service (for example `execute-api`, `s3`, or `sts`), and optional session token. Signs exact outgoing payload bytes, including binary and multipart bodies. Uses S3-specific path handling when service is `s3`. |

The active helper takes priority over an explicit Authorization header. API-key helpers replace only their configured key. No-auth leaves manually supplied headers available. HTTPS certificates use the runtime's normal verification.

When Reqora follows a redirect on the same origin, it signs the new URL/body again. On a cross-origin redirect it removes Authorization, cookies, AWS token/signing headers, and the helper's API key; it does not reapply the helper on the destination. Signing/negotiation stays within the request timeout and cancellation signal.

## OAuth 2.0

Supported grants are **authorization code with S256 PKCE**, **client credentials**, and **refresh token**. Supported access-token type is Bearer. Choose public client (client ID only), HTTP Basic client authentication, or client secret in the token request body according to your provider.

For authorization code:

1. Register an application with your provider and enter its client ID, authorization URL, token URL, optional secret, and requested scope.
2. Register the exact redirect URI with the provider. The default is your Reqora UI origin plus `/api/auth/callback`: typically `http://localhost:5173/api/auth/callback` for Docker web or `http://127.0.0.1:43129/api/auth/callback` for Electron. The actual host/port you use matters. Installed web builds use their configured web port.
3. Select **Get access token**, then **Open authorization page**. Electron opens this link in your default browser.
4. Authorize at the provider and return to Reqora. The callback validates the flow's random state, exchanges the code using its PKCE verifier, and applies the token. If automatic return is unavailable, paste the complete redirect URL into the in-app authorization panel and select **Complete authorization**.

A custom redirect URI must use HTTPS or loopback HTTP. Reqora does not host a custom callback path; manual completion works when you can obtain the full redirect URL. Provider support for PKCE is required. Sessions expire after ten minutes, can be cancelled, and callbacks/results are consumed once. Changing settings cancels a pending UI flow. The callback page never displays tokens or codes.

For client credentials, enter the token URL and client configuration, then get a token explicitly or let automatic acquisition obtain one at Send/run time. OAuth endpoints require HTTPS, with loopback HTTP allowed for local development. Token requests do not follow redirects and are limited to 15 seconds and a 256 KB response.

With automatic refresh enabled, the engine refreshes tokens within 30 seconds of expiry, or once after a 401 when a refresh token exists. Client-credentials grants can reacquire once after a 401 without a refresh token. Rotated refresh tokens are retained. A token obtained by Reqora is bound to its token URL, client ID, scope, and grant; changed/data-driven client identities acquire their own tokens. Manually pasted tokens can be used without a token endpoint; enter client/endpoint details to refresh them.

UI Send and collection runs persist received tokens at their owning request or collection, provided its settings have not changed during execution. Received updates are retained when a later stage fails or cancellation is observed. Runner variable-persistence settings do not disable token persistence. Unsaved request tokens still require saving that request to retain them after its tab closes. Refreshed tokens update matching open tabs without overwriting other edits.

## OAuth 1.0a token acquisition

Enter the consumer credentials and expand **Get an OAuth 1.0a access token**. Configure the request-token, authorization, and access-token URLs, plus the registered callback URI (defaults to the same Reqora callback as OAuth 2). Start authorization and open the provider page. The engine signs both exchanges and checks the returned temporary token and state. For providers supporting out-of-band authorization, set Callback URI to `oob` and paste the provider's verifier. You can also paste an existing access token and token secret directly.

## Runner, CLI and exports

Saved requests inherit collection authentication in normal sends, data runs, and CLI execution. Client-credentials acquisition and refresh work without browser interaction. Complete interactive authorization in the UI, save/export the workspace, then pass it to the CLI. To retain newly acquired or rotated tokens after a CLI run:

```sh
npm run cli -- run workspace.json --collection "My API" \
  --save-variables workspace-updated.json --report results.json
```

The output workspace contains both updated variables and OAuth tokens. The input is unchanged unless explicitly selected as output. Subsequent CLI runs should use the updated workspace, especially with rotating refresh tokens. JSON/JUnit run exports omit internal token-update records; logs, URLs, assertions, and extracted variables may still contain secrets supplied by your requests/scripts.

cURL generation resolves inherited helpers. Digest uses `--digest`, AWS uses `--aws-sigv4` (requires a supporting cURL build), and API keys/tokens become headers/query values. OAuth 2 exports require a current token. OAuth 1 preview obtains a freshly signed header from the running backend; its nonce/timestamp are for immediate use and it cannot re-sign a redirect. AWS multipart cURL export is unavailable; send those requests in Reqora. cURL follows its own redirect/credential rules.

Workspace storage and exports contain credentials without encryption. Password fields are visually masked. Tokens/keys are sent to the backend to contact the selected provider or API; they are not sent to a Reqora cloud service. Web and desktop workspaces remain separate; use exports to transfer saved settings.
