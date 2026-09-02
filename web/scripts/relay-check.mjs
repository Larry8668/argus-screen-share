// Exercises RoomDO: two roles join, messages relay, ping/pong, bad input rejected, leave notice.
// Usage: node scripts/relay-check.mjs [host]   (defaults to the production Worker)
const HOST = process.argv[2] ?? "argus.arry8668.workers.dev";
const CODE = "TEST" + Math.random().toString(36).slice(2, 4).toUpperCase();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);

function open(role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${HOST}/api/room/${CODE}/ws?role=${role}`);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => { const m = e.data; const w = waiters.shift(); w ? w(m) : inbox.push(m); };
    ws.next = (ms = 4000) => new Promise((res, rej) => {
      if (inbox.length) return res(inbox.shift());
      const t = setTimeout(() => rej(new Error(`timeout waiting on ${role}`)), ms);
      waiters.push((m) => { clearTimeout(t); res(m); });
    });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`${role} socket error`));
  });
}
const j = (s) => { try { return JSON.parse(s); } catch { return s; } };

// 1. bad room code rejected at the Worker
const bad = await fetch(`https://${HOST}/api/room/abc/ws?role=share`);
const noUpgrade = await fetch(`https://${HOST}/api/room/ABC123/ws?role=share`);
check("valid code, no upgrade → 426", noUpgrade.status === 426, `got ${noUpgrade.status}`);
check("bad code → 400", bad.status === 400, `got ${bad.status}`);

// 2. share joins first, alone
const share = await open("share");
let m = j(await share.next());
check("share hello, no peer", m.type === "hello" && m.role === "share" && m.peerPresent === false, JSON.stringify(m));

// 3. view joins; both sides notified
const view = await open("view");
m = j(await view.next());
check("view hello, peer present", m.type === "hello" && m.peerPresent === true, JSON.stringify(m));
m = j(await share.next());
check("share gets peer-joined", m.type === "peer-joined" && m.role === "view", JSON.stringify(m));

// 4. relay offer → view, answer → share, ice both ways
share.send(JSON.stringify({ type: "offer", sdp: "v=0 fake-offer" }));
m = j(await view.next());
check("offer relayed verbatim", m.type === "offer" && m.sdp === "v=0 fake-offer");
view.send(JSON.stringify({ type: "answer", sdp: "v=0 fake-answer" }));
m = j(await share.next());
check("answer relayed", m.type === "answer" && m.sdp === "v=0 fake-answer");
share.send(JSON.stringify({ type: "ice", candidate: { candidate: "a", sdpMid: "0" } }));
m = j(await view.next());
check("ice relayed", m.type === "ice" && m.candidate.candidate === "a");

// 5. ping/pong auto-response, unknown type rejected, non-JSON rejected
share.send("ping");
check("ping → pong", (await share.next()) === "pong");
share.send(JSON.stringify({ type: "hack" }));
m = j(await share.next());
check("unknown type → error to sender", m.type === "error", JSON.stringify(m));
share.send("not json");
m = j(await share.next());
check("non-JSON → error to sender", m.type === "error", JSON.stringify(m));

// 6. second viewer replaces the first
const view2 = await open("view");
m = j(await view2.next());
check("view2 hello", m.type === "hello" && m.peerPresent === true);
const closed = await new Promise((res) => { view.onclose = (e) => res(e); setTimeout(() => res(null), 4000); });
check("old view closed with 4000", closed?.code === 4000, closed ? `${closed.code} ${closed.reason}` : "no close");
// share sees: peer-left (old view closed) then peer-joined (view2) — order can vary
const a = j(await share.next()), b = j(await share.next());
const types = [a.type, b.type].sort().join(",");
check("share sees peer-left + peer-joined", types === "peer-joined,peer-left", types);

// 7. view2 leaves → share notified
view2.close(1000, "bye");
m = j(await share.next());
check("share gets peer-left on close", m.type === "peer-left" && m.role === "view", JSON.stringify(m));

share.close();
console.log(`room ${CODE}\n` + results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
