/**
 * ImportPanel Component
 *
 * Brings a watch history in from somewhere else.
 *
 * Most people arrive at this extension with years of viewing already recorded
 * on Netflix and, if they use it, a Letterboxd account that is the real record
 * of what they have seen. A library that starts empty asks them to rebuild all
 * of that by hand, which nobody does — so the list stays empty and the feature
 * dies. One file fixes that.
 *
 * The panel says plainly where each file comes from, because "upload your
 * export" is only actionable if you know an export exists. Netflix's is two
 * clicks and most people have never seen it.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  importFiles,
  toImportInput,
  type ImportSummary,
} from "@shared/utils/importLibrary";
import { describeImport, type ImportKind } from "@shared/utils/importParse";

type KindChoice = "auto" | ImportKind;

const KIND_CHOICES: Array<{ id: KindChoice; label: string }> = [
  { id: "auto", label: "Detect" },
  { id: "watched", label: "Watched" },
  { id: "watchlist", label: "Watchlist" },
];

interface ImportPanelProps {
  /** Called after a successful import, so the lists reload */
  onImported: (summary: ImportSummary) => void;
}

const ImportPanel: React.FC<ImportPanelProps> = ({ onImported }) => {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindChoice>("auto");
  const [showHelp, setShowHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;

      setBusy(true);
      setError(null);
      setSummary(null);

      try {
        const inputs = await Promise.all(Array.from(files).map(toImportInput));
        const result = await importFiles(inputs, kind === "auto" ? undefined : kind);

        setSummary(result);
        onImported(result);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
        // Clear the input, or picking the same file again fires no change event
        if (input.current) input.current.value = "";
      }
    },
    [kind, onImported]
  );

  return (
    <div>
      <p style={{ ...muted, marginBottom: "10px" }}>
        Upload a CSV or ZIP export. Everything is read here in the browser —
        nothing is uploaded anywhere.
      </p>

      <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
        {KIND_CHOICES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setKind(id)}
            title={
              id === "auto"
                ? "Read the list type from the file name"
                : `Treat every row as ${label.toLowerCase()}`
            }
            style={{
              flex: 1,
              background: kind === id ? "rgba(255,255,255,0.1)" : "transparent",
              border: `1px solid ${kind === id ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: "4px",
              color: kind === id ? "#fff" : "#8c8c8c",
              padding: "6px 4px",
              fontSize: "12px",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        ref={input}
        type="file"
        accept=".csv,.zip,text/csv,application/zip"
        multiple
        disabled={busy}
        onChange={(event) => void run(event.target.files)}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Reading…" : "Choose files"}
        </button>

        <button style={linkButton} onClick={() => setShowHelp(!showHelp)}>
          {showHelp ? "Hide" : "Where do I get one?"}
        </button>
      </div>

      {showHelp && <Help />}

      {error && <p style={{ ...warning, marginTop: "10px" }}>{error}</p>}

      {summary && (
        <div style={{ marginTop: "10px" }}>
          <p style={{ ...muted, color: "#d2d2d2" }}>{describeImport(summary)}</p>

          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
            {summary.files.map((file) => (
              <li key={file.fileName} style={{ ...muted, fontSize: "11px" }}>
                {file.fileName} · {SOURCE_NAMES[file.source]} · {file.kind} ·{" "}
                {file.rows.toLocaleString()} rows &rarr;{" "}
                {file.titles.length.toLocaleString()} titles
                {file.skipped > 0 ? ` · ${file.skipped.toLocaleString()} skipped` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const SOURCE_NAMES: Record<string, string> = {
  netflix: "Netflix",
  letterboxd: "Letterboxd",
  imdb: "IMDb",
  generic: "CSV",
};

/**
 * Where each export lives.
 *
 * Written as instructions rather than links because two of the three are
 * behind an account page that a link from an extension popup can't reach
 * usefully anyway, and because the paths are short enough to just say.
 */
const Help: React.FC = () => (
  <div
    style={{
      marginTop: "10px",
      padding: "10px",
      borderRadius: "4px",
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
    }}
  >
    <HelpRow
      name="Netflix"
      body="Account → Profile → Viewing activity, then “Download all” at the bottom. Episodes are folded into their show."
    />
    <HelpRow
      name="Letterboxd"
      body="Settings → Data → Export your data. Upload the ZIP as it comes; ratings, reviews and the watchlist all come across."
    />
    <HelpRow
      name="IMDb"
      body="Your Ratings or Watchlist → Export. These carry IMDb ids, so they match titles exactly."
    />
    <HelpRow
      name="Anything else"
      body="Prime Video and Disney+ have no simple export. Any CSV with a title column works — add a year, rating or date column and those come across too."
    />
  </div>
);

const HelpRow: React.FC<{ name: string; body: string }> = ({ name, body }) => (
  <p style={{ ...muted, fontSize: "11px", margin: "0 0 6px" }}>
    <span style={{ color: "#d2d2d2" }}>{name}</span> — {body}
  </p>
);

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

const linkButton: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8c8c8c",
  padding: 0,
  fontSize: "12px",
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "underline",
};

export default ImportPanel;
