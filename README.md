# Argus

Peer-to-peer screen sharing in the browser, plus a phone-as-microphone mode.

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
- NAT traversal: STUN first (direct path). If the Worker has TURN secrets set,
  `/api/ice` adds a TURN relay for networks where direct fails (symmetric NAT,
  blocked UDP). Without them it's STUN-only.

The room code is the only secret. Anyone with it can watch. One viewer per room; a
second viewer replaces the first.

## Use

1. On the machine to share: open `/share`, click **Share screen**, pick a screen (phones: **Share camera**).
2. On the device that's on the call: open the viewer link shown on the share page.
3. Share that tab into the call.

Both pages have a diagnostics panel. Once connected it shows the ICE path:
`host ↔ host` is same network, `srflx ↔ srflx` is direct across the internet,
`relay` means it went through TURN. The `video:` and `audio:` lines show bitrate,
fps, codec and packets. On `/share`, **Optimize for Video** trades sharpness for
smoothness on slow paths.

## Phone as a mic

Talk into your phone; the desktop hears it as a mic. `/mic` on the phone sends,
`/listen` on the desktop receives. Games and call apps need a free virtual cable on
the desktop, once. A browser can't create a mic device itself.

**Windows**
1. Download [VB-Cable](https://vb-audio.com/Cable/) and unzip it.
2. Right-click `VBCABLE_Setup_x64.exe` → Run as administrator → Install Driver. Reboot.
3. `/listen` → Start listening → Show all devices → pick **CABLE Input**.
4. Phone: `/mic` → enter the code → Start mic.
5. Set **CABLE Output** as the mic in Windows Sound settings, Discord or the game.

**macOS**: same, with `brew install blackhole-2ch` and **BlackHole 2ch** at both ends.

Troubleshooting: `/setup` on the live site.

## Develop

```
cd web
npm install
npm run dev            # Vite + local Worker and Durable Object
npm run build          # typecheck + build
npm run deploy         # build + wrangler deploy
npm run check:relay    # signaling smoke test against the deployed Worker
```

Needs Node 20+ and a Cloudflare account (`npx wrangler login`).

TURN (optional): `npx wrangler secret put TURN_URLS` (comma-separated `turn:` URLs),
`TURN_USERNAME`, `TURN_CREDENTIAL`. For local dev, put the same keys in
`web/.dev.vars`. Live logs: `npx wrangler tail argus`. After changing
`wrangler.jsonc`, run `npm run cf-typegen` to refresh `worker-configuration.d.ts`.

## Layout

```
web/
├── worker/index.ts     Worker entry: /api/health, /api/room/:code/ws, static assets
├── worker/room.ts      RoomDO — per-room WebSocket signaling relay + diagnostics logs
├── src/pages/Share.tsx Capture + offer
├── src/pages/View.tsx  Answer + play
├── src/pages/Mic.tsx   Phone mic sender
├── src/pages/Listen.tsx  Desktop mic receiver + output picker
├── src/pages/Setup.tsx   Virtual cable setup guide
├── src/lib/session.ts  Sender / Receiver (signaling + peer connection)
├── src/lib/            signaling client, peer helpers, audio, room codes
├── scripts/            relay-check.mjs
└── wrangler.jsonc      Worker, assets, Durable Object binding + migration
```

`client/` and `server/` are the previous FFmpeg + HLS + localtunnel version. Kept for
reference; not deployed.

## License

ISC
