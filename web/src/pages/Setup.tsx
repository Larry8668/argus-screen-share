import { Shell } from "../components/Shell";
import { CableSetup } from "../components/CableSetup";
import { Icon } from "../components/Icon";

export function Setup() {
  return (
    <Shell>
      <section className="hero compact">
        <h1>Phone as a mic: setup</h1>
        <p className="lede">Use your phone as this computer's mic in games, Discord and calls. Once, about 2 minutes.</p>
      </section>
      <section className="card">
        <CableSetup />
      </section>
      <a className="btn btn-primary self-center" href="/listen">
        Open the listener <Icon name="arrow" size={18} />
      </a>
    </Shell>
  );
}
