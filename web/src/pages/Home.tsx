export function Home() {
  return (
    <main className="page narrow">
      <h1>Argus</h1>
      <p className="muted">Peer-to-peer screen sharing. Nothing to install.</p>
      <div className="row">
        <a className="button" href="/share">Share my screen</a>
        <a className="button secondary" href="/view">Watch a screen</a>
      </div>
    </main>
  );
}
