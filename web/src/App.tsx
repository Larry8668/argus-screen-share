import { Home } from "./pages/Home";
import { Listen } from "./pages/Listen";
import { Mic } from "./pages/Mic";
import { Setup } from "./pages/Setup";
import { Share } from "./pages/Share";
import { View } from "./pages/View";

// Tiny path switch; the Worker serves index.html for every unknown path
// (wrangler.jsonc → assets.not_found_handling), so these work as deep links.
export default function App() {
  switch (location.pathname.replace(/\/+$/, "")) {
    case "/share":
      return <Share />;
    case "/view":
      return <View />;
    case "/mic":
      return <Mic />;
    case "/listen":
      return <Listen />;
    case "/setup":
      return <Setup />;
    default:
      return <Home />;
  }
}
