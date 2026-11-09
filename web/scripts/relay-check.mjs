// Exercises RoomDO: sharer + several viewers join, messages route by peer id, ping/pong,
// bad input rejected, room-full, same-id reclaim, leave notices.
// Usage: node scripts/relay-check.mjs [host | base URL]
//   (defaults to the production Worker; "localhost:5173" or "http://…" for local dev)
const ARG = process.argv[2] ?? "argus.arry8668.workers.dev";
const BASE = /^https?:\/\//.test(ARG) ? ARG.replace(/\/$/, "") : `${/^(localhost|127\.)/.test(ARG) ? "http" : "https"}://${ARG}`;
const WS_BASE = BASE.replace(/^http/, "ws");
const MAX_VIEWERS = 4;
const CODE = "TEST" + Math.random().toString(36).slice(2, 4).toUpperCase().padEnd(2, "X");
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
const j = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function open(role, query = "") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/room/${CODE}/ws?role=${role}${query}`);
    const inbox = [];
    const waiters = [];
    ws.closed = new Promise((res) => ws.addEventListener("close", (e) => res(e)));
    ws.onmessage = (e) => {
      const w = waiters.shift();
      if (w) w(e.data);
      else inbox.push(e.data);
    };
    /** Next message (parsed), or null after `ms`. */
    ws.next = (ms = 4000) =>
      new Promise((res) => {
        if (inbox.length) return res(j(inbox.shift()));
        const waiter = (m) => {
          clearTimeout(t);
          res(j(m));
        };
        const t = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          res(null);
        }, ms);
        waiters.push(waiter);
      });
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`${role} socket error`));
  });
}
const show = (m) => JSON.stringify(m);

// 1. bad room code rejected at the Worker
const bad = await fetch(`${BASE}/api/room/abc/ws?role=share`);
const noUpgrade = await fetch(`${BASE}/api/room/ABC123/ws?role=share`);
check("valid code, no upgrade → 426", noUpgrade.status === 426, `got ${noUpgrade.status}`);
check("bad code → 400", bad.status === 400, `got ${bad.status}`);

// 2. share joins first, alone
const share = await open("share");
let m = await share.next();
check("share hello, no peer", m?.type === "hello" && m.role === "share" && m.peerPresent === false, show(m));

// 3. a viewer joins; it gets an id, the sharer hears about that id
const v1 = await open("view");
m = await v1.next();
const id1 = m?.peer;
check("view hello with peer id, sharer present", m?.type === "hello" && m.peerPresent === true && /^[a-z0-9]{8,16}$/.test(id1 ?? ""), show(m));
m = await share.next();
check("share gets peer-joined with that id", m?.type === "peer-joined" && m.role === "view" && m.peer === id1, show(m));

// 4. viewer → sharer is stamped with the viewer's id (a spoofed one is overwritten); names cleaned
v1.sendJson({ type: "knock", from: "someoneelse", name: "  Al\u0000ice‮  " + "x".repeat(60) });
m = await share.next();
check("knock relayed with relay-stamped from", m?.type === "knock" && m.from === id1, show(m));
check("knock name sanitized and capped", typeof m?.name === "string" && m.name.startsWith("Alice") && m.name.length <= 40, show(m?.name));

// 5. sharer → viewer needs "to"; offer/answer/ice route correctly
share.sendJson({ type: "offer", id: "c1", sdp: "v=0 fake-offer" });
m = await share.next();
check("offer without 'to' → error to sharer", m?.type === "error", show(m));
share.sendJson({ type: "offer", id: "c1", to: id1, sdp: "v=0 fake-offer", voiceMid: "2" });
m = await v1.next();
check("offer relayed verbatim to its viewer", m?.type === "offer" && m.sdp === "v=0 fake-offer" && m.voiceMid === "2", show(m));
v1.sendJson({ type: "answer", id: "c1", sdp: "v=0 fake-answer" });
m = await share.next();
check("answer relayed with from", m?.type === "answer" && m.sdp === "v=0 fake-answer" && m.from === id1, show(m));
share.sendJson({ type: "ice", id: "c1", to: id1, candidate: { candidate: "a", sdpMid: "0" } });
m = await v1.next();
check("ice relayed to viewer", m?.type === "ice" && m.candidate.candidate === "a", show(m));
share.sendJson({ type: "ice", id: "c1", to: "nobody123", candidate: { candidate: "a" } });
m = await share.next();
check("message to unknown viewer → error", m?.type === "error", show(m));

// 6. ping/pong auto-response, unknown type rejected, non-JSON rejected
share.send("ping");
check("ping → pong", (await share.next()) === "pong");
share.sendJson({ type: "hack" });
m = await share.next();
check("unknown type → error to sender", m?.type === "error", show(m));
share.send("not json");
m = await share.next();
check("non-JSON → error to sender", m?.type === "error", show(m));

// 7. more viewers, up to the cap; each is addressed separately
const viewers = [v1];
const ids = [id1];
for (let i = 1; i < MAX_VIEWERS; i++) {
  const v = await open("view");
  const hello = await v.next();
  const joined = await share.next();
  viewers.push(v);
  ids.push(hello?.peer);
  check(`viewer ${i + 1} joins with its own id`, hello?.type === "hello" && joined?.peer === hello?.peer && !ids.slice(0, i).includes(hello?.peer), show(hello));
}
share.sendJson({ type: "lobby", to: ids[1], needName: true });
m = await viewers[1].next();
const leaked = await v1.next(800);
check("lobby goes only to its viewer", m?.type === "lobby" && m.needName === true && leaked === null, show(leaked ?? m));
share.sendJson({ type: "deny", to: ids[2] });
m = await viewers[2].next();
check("deny relayed", m?.type === "deny", show(m));
share.sendJson({ type: "admit", to: ids[3] });
m = await viewers[3].next();
check("admit relayed", m?.type === "admit", show(m));

// 8. one more viewer is refused with "room full" and close code 4001
const extra = await open("view");
m = await extra.next();
const fullClose = await Promise.race([extra.closed, new Promise((r) => setTimeout(() => r(null), 4000))]);
check("viewer over the cap gets room-full error", m?.type === "error" && m.code === "room-full", show(m));
check("…and close code 4001", fullClose?.code === 4001, fullClose ? `${fullClose.code} ${fullClose.reason}` : "no close");
const noise = await share.next(800);
check("sharer not told about the refused viewer", noise === null, show(noise));

// 9. a viewer reconnecting with its own id reclaims its slot, even when the room is full
const v1b = await open("view", `&peer=${id1}&resume=1`);
m = await v1b.next();
check("reclaim: same id handed back", m?.type === "hello" && m.peer === id1, show(m));
const replaced = await Promise.race([v1.closed, new Promise((r) => setTimeout(() => r(null), 4000))]);
check("reclaim: stale socket closed with 4000", replaced?.code === 4000, replaced ? `${replaced.code} ${replaced.reason}` : "no close");
m = await share.next();
check("reclaim: sharer gets peer-joined resume for the same id", m?.type === "peer-joined" && m.peer === id1 && m.resume === true, show(m));
// A replaced socket's close must not be announced as peer-left, or it could arrive after
// the new socket's handshake and tear the new call down.
m = await share.next(1500);
check("reclaim: no peer-left for the replaced socket", m === null, show(m));
viewers[0] = v1b;

// 10. a viewer leaving → sharer gets peer-left with its id
viewers[1].close(1000, "bye");
m = await share.next();
check("share gets peer-left with the viewer's id", m?.type === "peer-left" && m.role === "view" && m.peer === ids[1], show(m));

// 11. the sharer's bye (no "to") reaches every viewer
share.sendJson({ type: "bye" });
const byes = await Promise.all([viewers[0], viewers[2], viewers[3]].map((v) => v.next()));
check("sharer bye broadcast to all viewers", byes.every((b) => b?.type === "bye"), show(byes));

// 12. sharer leaves → every viewer gets peer-left
share.close(1000, "done");
const lefts = await Promise.all([viewers[0], viewers[2], viewers[3]].map((v) => v.next()));
check("viewers get peer-left when sharer closes", lefts.every((l) => l?.type === "peer-left" && l.role === "share"), show(lefts));

for (const v of viewers) v.close();
console.log(`room ${CODE} on ${BASE}\n` + results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
