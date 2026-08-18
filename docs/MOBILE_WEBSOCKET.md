# Mobile WebSocket Pairing

Nexy Desktop pairs with the Android companion over secure WebSockets. Pairing QR codes carry
both an authentication token and, for Nexy's local server, a certificate fingerprint that Android
pins for that paired server.

## Local LAN

By default, the desktop app starts a TLS WebSocket server with a locally generated certificate and
generates a QR code like:

```text
wss://192.168.x.x:<port>?token=<pairing-token>&certFP=<sha256-fingerprint>
```

Use this when the phone and desktop are on the same trusted local network. Android accepts the
local certificate only when its SHA-256 fingerprint matches the value in the QR/manual pairing
data; it does not accept arbitrary self-signed certificates.

## Secure External URL

For remote or Tailscale-style access, keep the Nexy mobile server running locally and expose it through a TLS-capable tunnel or reverse proxy. Then set the external URL in Desktop Settings > Mobile:

```text
wss://your-host.example/mobile
```

The desktop app adds the current pairing token to the QR code automatically. If the saved URL already has a token, it is replaced when the QR code is generated.

For an external URL without `certFP`, Android uses normal platform TLS validation, so the endpoint
needs a certificate trusted by Android. A manually supplied fingerprint enables certificate pinning
for that specific paired endpoint.

## Notes

- Leave the secure URL blank to use Nexy's local `wss://` LAN/Tailscale pairing service.
- The local certificate and private key are generated once and retained in the desktop settings
  database; regenerating the pairing token does not rotate the certificate.
- Regenerating the pairing token invalidates existing mobile connections for both local and secure URLs.

## Managed automated workflows

Paired Android can author and operate managed deliverable workflows through the desktop-owned
executor. Commands use the existing authenticated WebSocket envelope:

| Command | Purpose |
| --- | --- |
| `automated-workflow-managed:list-sources` | List selectable project files grouped by stable project source ID |
| `automated-workflow-managed:get-version` | Fetch one artifact version and its version history |
| `automated-workflow-managed:get-bindings` | Fetch exact input/output provenance for a run or step |
| `automated-workflow-managed:edit-version` | Compare-and-set edit that creates a new immutable version |
| `automated-workflow-managed:review` | Approve or reject one exact artifact version |
| `automated-workflow-managed:regenerate` | Reset a stale producer and its affected dependents |
| `automated-workflow-managed:create-preview` | Create a destination-checksummed unified diff |
| `automated-workflow-managed:confirm-publish` | Idempotently publish the previewed version |

Direct replies are `automated-workflow-managed:sources`, `:version`, `:bindings`,
`:publish-preview`, and `:publish-action`. Mutations also broadcast authoritative
`automated-workflow-runs:detail` and `automated-workflow-runs:changed` events so both clients
replace optimistic state after edits, reviews, regeneration, or publication. Reconnect handling
must request current sources and run details again; a disconnected client cannot queue review or
publish approval.

Managed workflow payloads contain source IDs and project-relative paths, never desktop root paths.
Artifact contents and diffs are returned only in direct authenticated responses and are not
included in routine notification bodies.
