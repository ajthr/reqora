# Cookies, proxies, and TLS

The web UI, Electron app, collection runner, and CLI use the same Node.js request engine. Open a request's **Settings** tab to configure its network behavior. The **Cookie jar** button in the toolbar or sidebar opens the workspace cookie editor.

## Cookie jar

Reqora accepts `Set-Cookie` from responses, including redirects, and sends cookies whose domain, path, Secure flag, and expiry match the next request URL. Cookies marked HttpOnly are still sent by the request engine. Session cookies persist across app restarts until you delete them. An explicit `Cookie` request header takes priority over the jar for that request. Uncheck **Send and store matching cookies** in Settings to disable jar use for a request.

The editor supports adding, editing, filtering, deleting, and clearing cookies. Set **Exact host only** for a cookie that should not reach subdomains. Leave expiry blank for a session cookie. Invalid domains, cookie prefixes, public suffixes, and expired cookies are rejected or omitted by the engine. The jar holds up to 300 cookies and 1 MB of workspace JSON. The current workspace stores cookies locally without encryption, and workspace exports include them. Web and desktop have separate workspaces; import an export to move cookies between them.

Collection runs share one jar across requests, rows, and iterations and apply newly received cookies to the workspace as each request finishes. CLI runs start with the cookies in the input workspace. Use `--save-variables FILE.json` to write a new workspace with updated cookies alongside variable and OAuth token changes. CLI reports omit the jar. The `/api/run-request` endpoint accepts an optional `cookies` array and returns updated `cookies` when it changes; callers must persist it themselves. The lower-level `/api/execute` endpoint accepts `cookies` and `network` with the prepared request and likewise returns cookie updates.

## Proxies

The Settings tab offers three modes:

- **Direct connection** ignores proxy environment variables. This is the default.
- **Use HTTP_PROXY / HTTPS_PROXY environment** reads `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` (or their lowercase forms) from the **request engine process**. For Docker, set them on the API container; for desktop or CLI, set them on the process that launches Reqora.
- **Custom HTTP(S) proxy** uses a proxy URL such as `http://proxy.example:8080`; credentials may be included in the URL. The bypass field accepts `NO_PROXY` syntax, for example `localhost, 127.0.0.1, .internal`. SOCKS proxies are not supported.

HTTP requests use the proxy directly; HTTPS requests use a tunnel. Reqora does not change the browser's own proxy settings. Proxy URLs and bypass values can contain `{{variables}}`, resolved using the request's collection, globals, and active data row.

## Certificates and mTLS

Paste PEM certificate text into **Custom CA certificate(s)** or drop a PEM file onto the field. The custom CA is added to the normal Node.js trust roots; server certificate and hostname verification stay enabled. For mTLS, provide both **Client certificate / chain** and the matching **Client private key**. Encrypted keys also need the **Private key passphrase**. Reqora checks the certificate and key pair before connecting. The client certificate is sent only to the initial HTTPS origin and its same-origin redirects; it is not forwarded to a different origin. Custom CA trust also applies to an HTTPS proxy.

Certificate fields and passphrases are saved as text in the request and included in workspace, collection, and request exports without encryption. Keep exports private. These fields support `{{variables}}`; missing variables cause an error before the request is sent. The browser never establishes the target TLS connection itself; the Node.js engine does.

Generated cURL includes custom proxy settings but cannot embed PEM certificates or the workspace cookie jar. Use the Reqora UI or CLI to replay a request with those settings, or configure equivalent cURL certificate and cookie files yourself.
