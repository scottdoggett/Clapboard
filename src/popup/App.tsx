/**
 * Clapboard Popup Root Component
 *
 * Main component for the browser action popup UI.
 * Displays extension status, settings, and quick actions.
 */

import React, { useState, useEffect } from "react";
import StatusCard from "./components/StatusCard";

/**
 * Extension status type
 */
type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/**
 * Popup root component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [currentSite, setCurrentSite] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(true);

  /**
   * Check extension status on mount
   */
  useEffect(() => {
    checkStatus();
    getCurrentTab();
  }, []);

  /**
   * Check connection to backend
   */
  const checkStatus = async (): Promise<void> => {
    try {
      // TODO: Implement actual status check via background script
      // For now, simulate a successful connection
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("connected");
    } catch (error) {
      console.error("[Clapboard Popup] Status check failed:", error);
      setStatus("error");
    }
  };

  /**
   * Get current tab info
   */
  const getCurrentTab = async (): Promise<void> => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab?.url) {
        const url = new URL(tab.url);
        setCurrentSite(url.hostname);
      }
    } catch (error) {
      console.error("[Clapboard Popup] Failed to get current tab:", error);
    }
  };

  /**
   * Toggle extension enabled state
   */
  const handleToggle = async (): Promise<void> => {
    const newState = !isEnabled;
    setIsEnabled(newState);

    // TODO: Persist to chrome.storage and notify content scripts
    await chrome.storage.local.set({ enabled: newState });
  };

  return (
    <div className="cb-bg-surface cb-text-white cb-p-4">
      {/* Header */}
      <div className="cb-flex cb-items-center cb-justify-between cb-mb-4">
        <div className="cb-flex cb-items-center cb-gap-2">
          <span className="cb-text-2xl">🎬</span>
          <h1 className="cb-text-lg cb-font-bold">Clapboard</h1>
        </div>
        <span className="cb-text-xs cb-text-gray-500">v0.1.0</span>
      </div>

      {/* Status Card */}
      <StatusCard
        status={status}
        currentSite={currentSite}
        isEnabled={isEnabled}
        onToggle={handleToggle}
      />

      {/* Quick Info Section */}
      <div className="cb-mt-4 cb-pt-4 cb-border-t cb-border-surface-lighter">
        <h2 className="cb-text-sm cb-font-medium cb-text-gray-400 cb-mb-2">
          Supported Sites
        </h2>
        <div className="cb-flex cb-flex-wrap cb-gap-2">
          {["Netflix", "Disney+", "Prime Video", "Crave"].map((site) => (
            <span
              key={site}
              className="cb-text-xs cb-bg-surface-light cb-px-2 cb-py-1 cb-rounded"
            >
              {site}
            </span>
          ))}
        </div>
      </div>

      {/* Footer Links */}
      <div className="cb-mt-4 cb-pt-4 cb-border-t cb-border-surface-lighter cb-flex cb-justify-between cb-text-xs cb-text-gray-500">
        <button className="cb-hover:text-white cb-transition-colors">
          Settings
        </button>
        <button className="cb-hover:text-white cb-transition-colors">
          Help
        </button>
        <button className="cb-hover:text-white cb-transition-colors">
          Feedback
        </button>
      </div>
    </div>
  );
};

export default App;
