export function Home() {
  return (
    <main className="page narrow">
      <h1>Argus</h1>
      <p className="muted">Peer-to-peer screen sharing. Nothing to install.</p>
      <div className="row">
        <a className="button" href="/share">Share my screen</a>
        <a className="button secondary" href="/view">Watch a screen</a>
      </div>
      <h2>Phone as a mic</h2>
      <p className="muted">Talk into your phone, hear it on the desktop.</p>
      <div className="row">
        <a className="button secondary" href="/listen">On the desktop</a>
        <a className="button secondary" href="/mic">On the phone</a>
      </div>
      <p className="muted small-text">
        To use it in games or Discord, the desktop needs a free virtual cable once. <a href="/setup">Setup guide</a>
      </p>
    </main>
  );
}
