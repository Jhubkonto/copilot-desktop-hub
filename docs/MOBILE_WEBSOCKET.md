# Mobile WebSocket Pairing

Nexy Desktop can pair with the Android companion app over either a local LAN WebSocket URL or a user-provided secure external WebSocket URL.

## Local LAN

By default, the desktop app starts a local WebSocket server and generates a QR code like:

```text
ws://192.168.x.x:<port>?token=<pairing-token>
```

Use this when the phone and desktop are on the same trusted local network. No TLS certificate is involved.

## Secure External URL

For remote or Tailscale-style access, keep the Nexy mobile server running locally and expose it through a TLS-capable tunnel or reverse proxy. Then set the external URL in Desktop Settings > Mobile:

```text
wss://your-host.example/mobile
```

The desktop app adds the current pairing token to the QR code automatically. If the saved URL already has a token, it is replaced when the QR code is generated.

Android uses normal platform TLS validation for `wss://` URLs, so the endpoint needs a certificate trusted by Android. Self-signed certificates are not supported by the app flow.

## Notes

- Leave the secure URL blank to keep local `ws://` LAN pairing.
- The desktop app does not currently manage certificates or run its own native TLS listener.
- Regenerating the pairing token invalidates existing mobile connections for both local and secure URLs.
