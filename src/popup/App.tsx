/**
 * Clapboard Popup
 *
 * Three things: your lists, your account, and settings.
 *
 * Styled to the same restraint as the overlay — near-black, hairline borders,
 * a little shadow for depth, and no colour beyond greyscale. The extension
 * spends its life inside Netflix, and a popup that looked like a different
 * product would be the only place that jarred.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { Message, MessageResponse, MessageResponseMap, ExtensionStatus } from "@shared/types/messages";
import { SUPPORTED_SITES } from "@shared/constants";
import AuthPanel from "./AuthPanel";
import LibraryList from "./LibraryList";

interface AppProps {
  /** Whether a Convex deployment is configured, so accounts are possible */
  hasConvex?: boolean;
}

async function sendMessage<T extends Message>(
  message: T
): Promise<MessageResponseMap[T["type"]]> {
  const response: MessageResponse = await chrome.runtime.sendMessage(message);
  if (!response.success) throw new Error(response.error || "Unknown error");
  return response.data as MessageResponseMap[T["type"]];
}

const App: React.FC<AppProps> = ({ hasConvex = false }) => {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await sendMessage({ type: "GET_STATUS" });
      setStatus(result);
      setUrlDraft(result.convexUrl);
      setError(null);
      // Settings is the one screen that matters when nothing is configured,
      // so it opens itself rather than hiding behind a button
      if (!result.configured) setShowSettings(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void load();

    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const url = tab?.url ?? "";
      const match = Object.values(SUPPORTED_SITES).find((config) =>
        config.hostPatterns.some((pattern) => url.includes(pattern))
      );
      setSite(match?.name ?? null);
    });
  }, [load]);

  const setEnabled = async (enabled: boolean): Promise<void> => {
    await sendMessage({ type: "SET_ENABLED", payload: { enabled } });
    await load();
  };

  const saveUrl = async (): Promise<void> => {
    await sendMessage({ type: "UPDATE_SETTINGS", payload: { convexUrl: urlDraft.trim() } });
    setNote("Saved. Reopen the popup to sign in against the new deployment.");
    await load();
  };

  const clearCache = async (): Promise<void> => {
    await sendMessage({ type: "CLEAR_CACHE" });
    setNote("Cached lookups cleared. Your list is untouched.");
    await load();
  };

  return (
    <div style={shell}>
      <header style={header}>
        <div>
          <h1 style={wordmark}>Clapboard</h1>
          <p style={{ ...muted, margin: "2px 0 0" }}>
            {site ? `On ${site}` : "Open a streaming site to see ratings"}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {status && (
            <Toggle
              on={status.enabled}
              onChange={(value) => void setEnabled(value)}
              label={status.enabled ? "Overlay on" : "Overlay off"}
            />
          )}
          <IconButton
            label="Settings"
            active={showSettings}
            onClick={() => setShowSettings(!showSettings)}
          >
            <GearIcon />
          </IconButton>
        </div>
      </header>

      {error && <Section><p style={warning}>{error}</p></Section>}

      {showSettings && (
        <Section title="Settings">
          <label style={{ ...muted, display: "block", marginBottom: "4px" }}>
            Convex deployment URL
          </label>
          <input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="https://your-deployment.convex.cloud"
            style={input}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button style={primaryButton} onClick={() => void saveUrl()}>
              Save
            </button>
            <button style={secondaryButton} onClick={() => void clearCache()}>
              Clear cache
            </button>
          </div>

          {note && <p style={{ ...muted, marginTop: "8px" }}>{note}</p>}

          <p style={{ ...muted, marginTop: "10px" }}>
            {status?.cacheSize ?? 0} cached lookups · v{status?.version ?? "—"}
          </p>
        </Section>
      )}

      <Section title="Account">
        {hasConvex ? (
          <AuthPanel
            onSignedIn={() => {
              // Merge rather than replace, so a list built signed out survives
              void sendMessage({ type: "SYNC_LIBRARY" })
                .then((result) =>
                  setNote(
                    result ? `Synced ${result.entries} titles to your account.` : null
                  )
                )
                .catch(() => setNote("Signed in, but syncing failed."))
                .finally(() => setRefreshKey((key) => key + 1));
            }}
          />
        ) : (
          <p style={muted}>
            Set a deployment URL in Settings to enable accounts. Your list works
            without one.
          </p>
        )}
      </Section>

      <Section title="Your list">
        <LibraryList refreshKey={refreshKey} />
      </Section>
    </div>
  );
};

const Section: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section style={section}>
    {title && <h2 style={sectionTitle}>{title}</h2>}
    {children}
  </section>
);

/**
 * A switch, rather than a button that says what it will do — the state is the
 * thing worth showing at a glance.
 */
const Toggle: React.FC<{
  on: boolean;
  label: string;
  onChange: (value: boolean) => void;
}> = ({ on, label, onChange }) => (
  <button
    onClick={() => onChange(!on)}
    title={label}
    aria-label={label}
    aria-pressed={on}
    style={{
      width: "36px",
      height: "20px",
      borderRadius: "10px",
      border: `1px solid ${on ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.18)"}`,
      background: on ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.06)",
      position: "relative",
      cursor: "pointer",
      padding: 0,
      transition: "background 140ms ease, border-color 140ms ease",
    }}
  >
    <span
      style={{
        position: "absolute",
        top: "2px",
        left: on ? "18px" : "2px",
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        background: on ? "#141414" : "rgba(255,255,255,0.6)",
        transition: "left 140ms ease",
      }}
    />
  </button>
);

const IconButton: React.FC<{
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active, onClick, children }) => (
  <button
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "28px",
      height: "28px",
      borderRadius: "4px",
      border: `1px solid ${active ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.14)"}`,
      background: active ? "rgba(255,255,255,0.1)" : "transparent",
      color: active ? "#fff" : "#a8a8a8",
      cursor: "pointer",
      padding: 0,
    }}
  >
    {children}
  </button>
);

const GearIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 005 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H10a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V10a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);

// --- Styles ----------------------------------------------------------------

const shell: React.CSSProperties = {
  width: "340px",
  maxHeight: "580px",
  overflowY: "auto",
  background: "#0f0f10",
  color: "#fff",
  fontFamily:
    '"Netflix Sans", "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "10px",
  padding: "14px 16px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
};

const wordmark: React.CSSProperties = {
  margin: 0,
  fontSize: "15px",
  fontWeight: 500,
  letterSpacing: "0.02em",
};

const section: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: "11px",
  fontWeight: 400,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "#8c8c8c",
};

const muted: React.CSSProperties = {
  color: "#8c8c8c",
  fontSize: "12px",
  lineHeight: "17px",
  margin: 0,
};

const warning: React.CSSProperties = {
  color: "#e5a3a3",
  fontSize: "12px",
  lineHeight: "17px",
  margin: 0,
};

const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(0, 0, 0, 0.4)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "4px",
  color: "#fff",
  padding: "8px 10px",
  fontSize: "12px",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  background: "#fff",
  color: "#141414",
  border: "none",
  borderRadius: "4px",
  padding: "7px 14px",
  fontSize: "12px",
  fontFamily: "inherit",
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  background: "transparent",
  color: "#d2d2d2",
  border: "1px solid rgba(255, 255, 255, 0.22)",
  borderRadius: "4px",
  padding: "7px 14px",
  fontSize: "12px",
  fontFamily: "inherit",
  cursor: "pointer",
};

export default App;
