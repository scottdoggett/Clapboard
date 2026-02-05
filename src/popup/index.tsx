/**
 * Clapboard Popup Entry Point
 *
 * Initializes the React app for the browser action popup.
 * The popup provides quick access to:
 * - Extension status and connection health
 * - Settings and preferences
 * - Quick info about the current page/title
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Import styles (processed by build pipeline)
import "../content/styles/overlay.css";

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
      <App />
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
