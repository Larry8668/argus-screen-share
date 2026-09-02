import { Home } from "./pages/Home";
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
    default:
      return <Home />;
  }
}
