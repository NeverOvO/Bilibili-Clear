# Bilibili Clear Dev Server

## HTTP

The HTTP server listens on `127.0.0.1` only. It serves userscript files and source maps under `dist/`; repository source files and other directories are not exposed. Symlinks outside the output directory are rejected.

- `dist/*.user.js` and `dist/*.user.js.map` -> core userscript outputs

Requests to `registry/dist/components/<id>.js` and `registry/dist/plugins/<id>.js` are virtual output URLs. They trigger build-on-request when the memory output is missing, then return the compiled output from memory. Other `/registry/*` URLs are not served from disk. HTTP does not expose control APIs.

## WebSocket

Dev server WebSocket: `ws://127.0.0.1:23333` by default.

Every server start generates a fresh, in-memory session token. The CLI and the current DevClient automatically retrieve it through `GET /__dev/session` with the `x-bilibili-clear-dev-client: 1` header. This endpoint does not enable CORS, and preflight requests are rejected. No token is stored in a file or in exported settings.

WebSocket connections send the `bilibili-clear-dev` and `token.<session-token>` subprotocols. The server validates the token, the loopback Host header, and the Origin (local HTTP or HTTPS Bilibili pages). Messages have a 64 KiB limit; command types, feature kinds, IDs, paths and field types are checked before execution. Source directories cannot escape their component/plugin root through path segments or symlinks.

Install the DevClient from this running server at `http://127.0.0.1:23333/registry/dist/components/utils/dev-client.js`. Older upstream DevClient versions do not support the session handshake. Browser script-manager permissions for localhost requests are still required.

WebSocket is the command and event control plane.

Client commands:

```json
{ "type": "queryFeatureSessions" }
```

```json
{ "type": "shutdownServer", "requestId": "..." }
```

```json
{ "type": "buildFeature", "kind": "component", "id": "style/hide/banner", "requestId": "..." }
```

```json
{ "type": "startFeatureSession", "kind": "plugin", "id": "video/player/speed", "requestId": "..." }
```

```json
{ "type": "stopFeatureSession", "kind": "component", "id": "style/hide/banner", "requestId": "..." }
```

```json
{
  "type": "startDebugFeature",
  "kind": "component",
  "id": "style/hide/banner",
  "targetClientId": "dev-client-1",
  "requestId": "..."
}
```

```json
{
  "type": "createFeature",
  "kind": "component",
  "id": "style/my-feature",
  "name": "myFeature",
  "displayName": "My Feature",
  "authorName": "Author Name",
  "authorLink": "https://example.com",
  "description": "Feature description.",
  "requestId": "..."
}
```

Server events:

- `serverReady`: initial connection event with `clientId` and active `featureSessions`.
- `featureSessionsChanged`: active watched feature paths changed.
- `itemUpdate`: watched feature compiled and DevClient should update.
- `featureBuilt`: explicit feature build or watched build completed.
- `featureBuildFailed`: explicit feature build failed.
- `serverStop`: server is shutting down; DevClient should restore dev URLs and close the socket.
- `commandResult`: response for commands with `requestId`.

## CLI

Use the command client while the dev server is running:

```powershell
pnpm tsx dev-tools/dev-server/command.ts sessions
pnpm tsx dev-tools/dev-server/command.ts build component style/hide/banner
pnpm tsx dev-tools/dev-server/command.ts watch plugin video/player/speed
pnpm tsx dev-tools/dev-server/command.ts stop component style/hide/banner
pnpm tsx dev-tools/dev-server/command.ts start-debug component style/hide/banner dev-client-1
pnpm tsx dev-tools/dev-server/command.ts stop-debug component style/hide/banner
pnpm tsx dev-tools/dev-server/command.ts shutdown
```

`shutdown` responds to the command client, broadcasts `serverStop`, and then gracefully closes core and feature watchers, WebSocket connections, and the HTTP server.
