import { Shell } from "../components/Shell";
import { CodeEntry } from "../components/CodeEntry";
import { Icon, type IconName } from "../components/Icon";

const ACTIONS: { href: string; icon: IconName; title: string; body: string }[] = [
  { href: "/share", icon: "screen", title: "Share my screen", body: "Get a code, send it to whoever's watching." },
  { href: "/listen", icon: "ear", title: "Phone as a mic", body: "Talk into your phone, hear it on this computer." },
];

export function Home() {
  return (
    <Shell>
      <section className="hero">
        <h1>
          Your screen, <span className="accent">anywhere</span>.
        </h1>
        <p className="lede">Peer-to-peer screen sharing in the browser. No installs, no accounts.</p>
      </section>

      <section className="card join-card">
        <div className="eyebrow">Got a code? Watch a screen</div>
        <CodeEntry action="Watch" onSubmit={(code) => (location.href = `/view?code=${code}`)} autoFocus={false} />
      </section>

      <div className="choices">
        {ACTIONS.map((a) => (
          <a key={a.href} className="choice" href={a.href}>
            <span className="choice-icon"><Icon name={a.icon} size={26} /></span>
            <span className="choice-title">{a.title}</span>
            <span className="choice-body">{a.body}</span>
          </a>
        ))}
      </div>

      <p className="footnote">
        On a phone that should be the mic? Open <a href="/mic">/mic</a>. Using it in games or Discord needs a{" "}
        <a href="/setup">one-time setup</a>.
      </p>
    </Shell>
  );
}
