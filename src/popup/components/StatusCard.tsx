/**
 * StatusCard Component
 *
 * Displays the extension's connection status and current site info.
 * Provides a toggle to enable/disable the extension.
 */

import React from "react";

type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

interface StatusCardProps {
  status: ConnectionStatus;
  currentSite: string | null;
  isEnabled: boolean;
  onToggle: () => void;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; bgColor: string; glowColor: string }
> = {
  connected: {
    label: "Connected",
    color: "#4ade80",
    bgColor: "#4ade80",
    glowColor: "rgba(74, 222, 128, 0.4)",
  },
  connecting: {
    label: "Connecting...",
    color: "#facc15",
    bgColor: "#facc15",
    glowColor: "rgba(250, 204, 21, 0.4)",
  },
  disconnected: {
    label: "Disconnected",
    color: "#9ca3af",
    bgColor: "#9ca3af",
    glowColor: "rgba(156, 163, 175, 0.4)",
  },
  error: {
    label: "Error",
    color: "#f87171",
    bgColor: "#f87171",
    glowColor: "rgba(248, 113, 113, 0.4)",
  },
};

const StatusCard: React.FC<StatusCardProps> = ({
  status,
  currentSite,
  isEnabled,
  onToggle,
}) => {
  const statusConfig = STATUS_CONFIG[status];
  const isSupportedSite = checkIfSupported(currentSite);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.05)",
        borderRadius: 12,
        padding: 14,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Status Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Status indicator dot with glow */}
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: statusConfig.bgColor,
              boxShadow: `0 0 8px ${statusConfig.glowColor}`,
              animation: status === "connecting" ? "pulse 1.5s infinite" : "none",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 500, color: statusConfig.color }}>
            {statusConfig.label}
          </span>
        </div>

        {/* Modern Toggle Switch */}
        <button
          onClick={onToggle}
          style={{
            position: "relative",
            width: 44,
            height: 24,
            borderRadius: 12,
            border: "none",
            cursor: "pointer",
            background: isEnabled
              ? "linear-gradient(135deg, #f04d42 0%, #e63946 100%)"
              : "rgba(255,255,255,0.15)",
            transition: "all 0.3s ease",
            boxShadow: isEnabled ? "0 2px 8px rgba(240, 77, 66, 0.3)" : "none",
          }}
          aria-label={isEnabled ? "Disable Clapboard" : "Enable Clapboard"}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: isEnabled ? 23 : 3,
              width: 18,
              height: 18,
              backgroundColor: "#fff",
              borderRadius: "50%",
              transition: "all 0.3s ease",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
          />
        </button>
      </div>

      {/* Current Site Info */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 14,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "rgba(255,255,255,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          Current Page
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              color: "#fff",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {currentSite || "No page detected"}
          </span>
          {currentSite && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: 6,
                background: isSupportedSite
                  ? "rgba(74, 222, 128, 0.15)"
                  : "rgba(255,255,255,0.08)",
                color: isSupportedSite ? "#4ade80" : "rgba(255,255,255,0.5)",
                border: `1px solid ${isSupportedSite ? "rgba(74, 222, 128, 0.3)" : "rgba(255,255,255,0.1)"}`,
              }}
            >
              {isSupportedSite ? "Supported" : "Not supported"}
            </span>
          )}
        </div>
      </div>

      {/* Disabled Warning */}
      {!isEnabled && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              background: "rgba(250, 204, 21, 0.1)",
              borderRadius: 8,
              border: "1px solid rgba(250, 204, 21, 0.2)",
            }}
          >
            <span style={{ fontSize: 14 }}>⚠️</span>
            <p style={{ margin: 0, fontSize: 12, color: "#facc15" }}>
              Clapboard is disabled. Toggle on to see ratings.
            </p>
          </div>
        </div>
      )}

      {/* Pulse Animation Keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
};

function checkIfSupported(hostname: string | null): boolean {
  if (!hostname) return false;
  const supportedPatterns = [
    "netflix.com",
    "disneyplus.com",
    "primevideo.com",
    "amazon.com",
    "crave.ca",
  ];
  return supportedPatterns.some((pattern) => hostname.includes(pattern));
}

export default StatusCard;
