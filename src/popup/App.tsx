/**
 * Clapboard Popup Root Component
 *
 * Main component for the browser action popup UI.
 * Displays extension status, settings, and quick actions.
 */

import React, { useState, useEffect, useCallback } from "react";
import StatusCard from "./components/StatusCard";
import type {
  Message,
  MessageResponse,
  MessageResponseMap,
  ExtensionStatus,
} from "@shared/types/messages";

type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/**
 * Send a message to the background worker and unwrap its response
 */
async function sendMessage<T extends Message>(
  message: T
): Promise<MessageResponseMap[T["type"]]> {
  const response: MessageResponse = await chrome.runtime.sendMessage(message);

  if (!response.success) {
    throw new Error(response.error || "Unknown error");
  }

  return response.data as MessageResponseMap[T["type"]];
}

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [currentSite, setCurrentSite] = useState<string | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus | null>(
    null
  );
  const [showSettings, setShowSettings] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const isEnabled = extensionStatus?.enabled ?? true;

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await sendMessage({ type: "GET_STATUS" });

      setExtensionStatus(result);
      setUrlDraft(result.convexUrl);

      // "Connected" here means the extension knows where its backend is. The
      // popup deliberately doesn't ping Convex — a lookup would cost an API
      // call just to render a status dot.
      setStatus(result.configured ? "connected" : "disconnected");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void getCurrentTab();
  }, [loadStatus]);

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
    try {
      const settings = await sendMessage({
        type: "SET_ENABLED",
        payload: { enabled: !isEnabled },
      });

      setExtensionStatus((prev) =>
        prev ? { ...prev, enabled: settings.enabled } : prev
      );
    } catch {
      setStatus("error");
    }
  };

  const handleSaveUrl = async (): Promise<void> => {
    try {
      await sendMessage({
        type: "UPDATE_SETTINGS",
        payload: { convexUrl: urlDraft.trim() },
      });

      setSaveMessage("Saved — cache cleared");
      await loadStatus();
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleClearCache = async (): Promise<void> => {
    try {
      await sendMessage({ type: "CLEAR_CACHE" });

      setSaveMessage("Cache cleared");
      await loadStatus();
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Failed to clear cache");
    }
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
          v{extensionStatus?.version ?? "0.1.0"}
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

        {/* Backend not configured — the overlay can't fetch anything without it */}
        {extensionStatus && !extensionStatus.configured && !showSettings && (
          <button
            onClick={() => setShowSettings(true)}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "10px 12px",
              background: "rgba(248, 113, 113, 0.12)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              borderRadius: 8,
              color: "#f87171",
              fontSize: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            No backend configured — set a Convex URL to start seeing ratings.
          </button>
        )}

        {showSettings ? (
          <div style={{ marginTop: 16 }}>
            <h2 style={sectionHeadingStyle}>Backend</h2>

            <label
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                marginBottom: 6,
              }}
              htmlFor="convex-url"
            >
              Convex deployment URL
            </label>
            <input
              id="convex-url"
              type="url"
              value={urlDraft}
              onChange={(e) => {
                setUrlDraft(e.target.value);
                setSaveMessage(null);
              }}
              placeholder="https://your-deployment.convex.cloud"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                fontSize: 12,
                color: "#fff",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                outline: "none",
              }}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={handleSaveUrl} style={primaryButtonStyle}>
                Save
              </button>
              <button onClick={handleClearCache} style={secondaryButtonStyle}>
                Clear cache ({extensionStatus?.cacheSize ?? 0})
              </button>
            </div>

            {saveMessage && (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                {saveMessage}
              </p>
            )}
          </div>
        ) : (
          /* Supported Services */
          <div style={{ marginTop: 16 }}>
            <h2 style={sectionHeadingStyle}>Supported Platforms</h2>
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
        )}
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
        <FooterButton
          label={showSettings ? "Done" : "Settings"}
          onClick={() => {
            setShowSettings(!showSettings);
            setSaveMessage(null);
          }}
        />
        <FooterButton
          label="Help"
          onClick={() =>
            void chrome.tabs.create({
              url: "https://github.com/your-username/clapboard#readme",
            })
          }
        />
      </div>
    </div>
  );
};

/**
 * Footer link button
 */
const FooterButton: React.FC<{ label: string; onClick: () => void }> = ({
  label,
  onClick,
}) => (
  <button
    onClick={onClick}
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
    {label}
  </button>
);

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "rgba(255,255,255,0.5)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 10px 0",
};

const primaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  background: "linear-gradient(135deg, #f04d42 0%, #e63946 100%)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  fontSize: 12,
  color: "rgba(255,255,255,0.7)",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  cursor: "pointer",
};

export default App;
