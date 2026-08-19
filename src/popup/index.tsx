/**
 * Clapboard Popup Entry Point
 *
 * Initializes the React app for the browser action popup.
 * The popup provides quick access to:
 * - Extension status and connection health
 * - Settings and preferences
 * - Quick info about the current page/title
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import { getSettings } from "@shared/utils/storage";
import { chromeTokenStorage } from "@shared/utils/authStorage";

// Import styles (processed by build pipeline)
import "../content/styles/overlay.css";

/**
 * Convex URL baked in at build time; a URL set in Settings takes precedence.
 */
const BUILD_TIME_CONVEX_URL = process.env.CONVEX_URL || "";

/**
 * Wraps the popup in Convex Auth once the deployment URL is known.
 *
 * The client can't be built until then, and the URL lives in storage because
 * it is user-configurable — so the popup renders unauthenticated first and
 * gains a session when the URL resolves. With no URL configured it stays
 * unwrapped, and Settings still works: that is the one screen someone needs
 * when nothing else does.
 *
 * Tokens go in `chrome.storage` rather than `localStorage` so the background
 * worker shares the session — see `authStorage.ts`.
 */
const Root: React.FC = () => {
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;

    void getSettings().then((settings) => {
      if (!active) return;

      const url = settings.convexUrl || BUILD_TIME_CONVEX_URL;
      if (url) setClient(new ConvexReactClient(url));
      setResolved(true);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!resolved) return null;
  if (!client) return <App hasConvex={false} />;

  return (
    <ConvexAuthProvider client={client} storage={chromeTokenStorage}>
      <App hasConvex />
    </ConvexAuthProvider>
  );
};

/**
 * Mount the React app to the DOM
 */
function mount(): void {
  const container = document.getElementById("root");

  if (!container) {
    console.error("[Clapboard Popup] Root element not found");
    return;
  }

  const root = createRoot(container);

  root.render(
    <StrictMode>
      <Root />
    </StrictMode>
  );

  console.log("[Clapboard Popup] Mounted successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
