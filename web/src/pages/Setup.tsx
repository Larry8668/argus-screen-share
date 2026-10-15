import { CableSetup } from "../components/CableSetup";

export function Setup() {
  return (
    <main className="page">
      <header className="bar">
        <a href="/" className="brand">Argus</a>
        <a href="/listen" className="button small">Open /listen</a>
      </header>
      <section className="card">
        <h2 className="flush">Phone as a mic: setup</h2>
        <p className="muted">Use your phone as this computer's mic in games, Discord and calls. One-time setup.</p>
        <CableSetup />
      </section>
    </main>
  );
}
