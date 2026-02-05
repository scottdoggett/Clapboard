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

/**
 * Status indicator configuration
 */
const STATUS_CONFIG: Record<
  ConnectionStatus,
  {
    label: string;
    color: string;
    bgColor: string;
  }
> = {
  connected: {
    label: "Connected",
    color: "cb-text-green-400",
    bgColor: "cb-bg-green-400",
  },
  connecting: {
    label: "Connecting...",
    color: "cb-text-yellow-400",
    bgColor: "cb-bg-yellow-400",
  },
  disconnected: {
    label: "Disconnected",
    color: "cb-text-gray-400",
    bgColor: "cb-bg-gray-400",
  },
  error: {
    label: "Error",
    color: "cb-text-red-400",
    bgColor: "cb-bg-red-400",
  },
};

/**
 * Status card component
 */
const StatusCard: React.FC<StatusCardProps> = ({
  status,
  currentSite,
  isEnabled,
  onToggle,
}) => {
  const statusConfig = STATUS_CONFIG[status];
  const isSupportedSite = checkIfSupported(currentSite);

  return (
    <div className="cb-bg-surface-light cb-rounded-lg cb-p-3">
      {/* Status Row */}
      <div className="cb-flex cb-items-center cb-justify-between cb-mb-3">
        <div className="cb-flex cb-items-center cb-gap-2">
          {/* Status indicator dot */}
          <span
            className={`cb-w-2 cb-h-2 cb-rounded-full ${statusConfig.bgColor} ${
              status === "connecting" ? "cb-animate-pulse" : ""
            }`}
          />
          <span className={`cb-text-sm ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>

        {/* Enable/Disable Toggle */}
        <button
          onClick={onToggle}
          className={`cb-relative cb-w-10 cb-h-5 cb-rounded-full cb-transition-colors ${
            isEnabled ? "cb-bg-primary-600" : "cb-bg-surface-lighter"
          }`}
          aria-label={isEnabled ? "Disable Clapboard" : "Enable Clapboard"}
        >
          <span
            className={`cb-absolute cb-top-0.5 cb-w-4 cb-h-4 cb-bg-white cb-rounded-full cb-transition-transform ${
              isEnabled ? "cb-translate-x-5" : "cb-translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Current Site Info */}
      <div className="cb-border-t cb-border-surface-lighter cb-pt-3">
        <div className="cb-text-xs cb-text-gray-500 cb-mb-1">Current Page</div>
        <div className="cb-flex cb-items-center cb-gap-2">
          <span className="cb-text-sm cb-text-white cb-truncate">
            {currentSite || "Unknown"}
          </span>
          {currentSite && (
            <span
              className={`cb-text-xs cb-px-1.5 cb-py-0.5 cb-rounded ${
                isSupportedSite
                  ? "cb-bg-green-900 cb-text-green-400"
                  : "cb-bg-surface-lighter cb-text-gray-500"
              }`}
            >
              {isSupportedSite ? "Supported" : "Not supported"}
            </span>
          )}
        </div>
      </div>

      {/* Not enabled warning */}
      {!isEnabled && (
        <div className="cb-mt-3 cb-pt-3 cb-border-t cb-border-surface-lighter">
          <p className="cb-text-xs cb-text-yellow-400">
            Clapboard is currently disabled. Toggle on to see ratings and scores.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Check if the current site is supported
 */
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
