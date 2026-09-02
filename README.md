# Argus

Peer-to-peer screen sharing in the browser. Nothing to install on either side.

Live: https://argus.arry8668.workers.dev

## Why

A desktop with no mic can't be the device you join a call from. Argus lets that desktop
push its screen to whatever device *is* on the call, so you share the viewer tab there.
One participant, one mic, the desktop's screen.

## How it works

- `/share` captures a screen or window with `getDisplayMedia` and sends it over WebRTC.
- `/view` receives it. Open it with `?code=XXXXXX` or type the code in.
- A Cloudflare Worker serves both pages. One Durable Object per room code relays the
  WebRTC handshake (offer, answer, ICE candidates) over WebSockets. After the handshake
  the video goes directly between the two browsers; the Worker carries no media.
- NAT traversal is STUN-only (Cloudflare and Google public servers). There is no TURN
  relay, so networks with symmetric NAT or blocked UDP will fail to connect. Home
  Wi-Fi to mobile data is verified working.

The room code is the only secret. Anyone with it can watch. One viewer per room; a
second viewer replaces the first.

## Use

1. On the machine to share: open `/share`, click **Start sharing**, pick a screen.
2. On the device that's on the call: open the viewer link shown on the share page.
3. Share that tab into the call.

Both pages have a diagnostics panel. Once connected it shows the ICE path:
`host ↔ host` is same network, `srflx ↔ srflx` is direct across the internet,
`relay` would mean TURN (not configured).

## Develop

```
cd web
npm install
npm run dev            # Vite + local Worker and Durable Object
npm run build          # typecheck + build
npm run deploy         # build + wrangler deploy
npm run check:relay    # signaling smoke test against the deployed Worker
```

Needs Node 20+ and a Cloudflare account (`npx wrangler login`). After changing
`wrangler.jsonc`, run `npm run cf-typegen` to refresh `worker-configuration.d.ts`.

## Layout

```
web/
├── worker/index.ts     Worker entry: /api/health, /api/room/:code/ws, static assets
├── worker/room.ts      RoomDO — per-room WebSocket signaling relay
├── src/pages/Share.tsx Capture + offer
├── src/pages/View.tsx  Answer + play
├── src/lib/            signaling client, peer helpers, room codes
├── scripts/            relay-check.mjs
└── wrangler.jsonc      Worker, assets, Durable Object binding + migration
```

`client/` and `server/` are the previous FFmpeg + HLS + localtunnel version. Kept for
reference; not deployed.

## License

ISC
