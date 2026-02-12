/**
 * Clapboard Popup Root Component
 *
 * Main component for the browser action popup UI.
 * Displays extension status, settings, and quick actions.
 */

import React, { useState, useEffect } from "react";
import StatusCard from "./components/StatusCard";

type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [currentSite, setCurrentSite] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    checkStatus();
    getCurrentTab();
  }, []);

  const checkStatus = async (): Promise<void> => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStatus("connected");
    } catch {
      setStatus("error");
    }
  };

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
    } catch {
      // Ignore errors
    }
  };

  const handleToggle = async (): Promise<void> => {
    const newState = !isEnabled;
    setIsEnabled(newState);
    await chrome.storage.local.set({ enabled: newState });
  };

  const streamingServices = [
    { name: "Netflix", icon: "🎬", color: "#E50914" },
    { name: "Disney+", icon: "✨", color: "#0063E5" },
    { name: "Prime", icon: "📦", color: "#00A8E1" },
    { name: "Crave", icon: "🍿", color: "#0070C9" },
  ];

  return (
    <div
      style={{
        width: 320,
        minHeight: 280,
        background: "linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)",
        color: "#fff",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #f04d42 0%, #e63946 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              boxShadow: "0 4px 12px rgba(240, 77, 66, 0.3)",
            }}
          >
            🎬
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Clapboard
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Movie ratings at a glance
            </p>
          </div>
        </div>
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.08)",
            padding: "3px 8px",
            borderRadius: 12,
          }}
        >
          v0.1.0
        </span>
      </div>

      {/* Main Content */}
      <div style={{ padding: 16 }}>
        <StatusCard
          status={status}
          currentSite={currentSite}
          isEnabled={isEnabled}
          onToggle={handleToggle}
        />

        {/* Supported Services */}
        <div style={{ marginTop: 16 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: "0 0 10px 0",
            }}
          >
            Supported Platforms
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            {streamingServices.map((service) => (
              <div
                key={service.name}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 10,
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  cursor: "default",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>{service.icon}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
                  {service.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          justifyContent: "center",
          gap: 24,
        }}
      >
        {["Settings", "Help", "Feedback"].map((item) => (
          <button
            key={item}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              fontSize: 12,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
              transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = "rgba(255,255,255,0.5)";
              e.currentTarget.style.background = "none";
            }}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
