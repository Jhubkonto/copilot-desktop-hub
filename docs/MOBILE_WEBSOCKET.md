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
