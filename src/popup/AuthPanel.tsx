/**
 * AuthPanel Component
 *
 * Sign in, sign up, sign out.
 *
 * Signing in is optional and the copy says so. Everything works signed out —
 * an account only makes the library survive a reinstall and follow you to
 * another browser. Presenting it as a requirement would misdescribe what the
 * extension does.
 */

import React, { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";

type Flow = "signIn" | "signUp";

/**
 * Addressed by name rather than through the generated `api` object, matching
 * the rest of the extension — the bundle must build without `convex/_generated`.
 */
const meRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { id: string; email: string | null; name: string | null } | null
>("library:me");

interface AuthPanelProps {
  onSignedIn: () => void;
}

const AuthPanel: React.FC<AuthPanelProps> = ({ onSignedIn }) => {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(meRef, isAuthenticated ? {} : "skip");

  const [flow, setFlow] = useState<Flow>("signIn");
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) {
    return <p style={mutedText}>Checking your session…</p>;
  }

  if (isAuthenticated) {
    return (
      <div style={row}>
        <div style={{ minWidth: 0 }}>
          <p style={{ ...mutedText, margin: 0 }}>Signed in</p>
          <p
            style={{
              margin: "2px 0 0",
              color: "#fff",
              fontSize: "13px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me?.email ?? "your account"}
          </p>
        </div>
        <button style={secondaryButton} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await signIn("password", { ...form, flow });
      onSignedIn();
    } catch (caught) {
      // Convex Auth reports both a wrong password and an unknown account the
      // same way, so the message says what to try rather than guessing which
      setError(
        flow === "signIn"
          ? "Couldn't sign in. Check the email and password, or create an account."
          : `Couldn't create the account. ${describe(caught)}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <p style={{ ...mutedText, margin: "0 0 10px" }}>
        Optional. Your list works without an account — signing in keeps it when
        you reinstall or switch browsers.
      </p>

      <input
        type="email"
        required
        autoComplete="username"
        placeholder="Email"
        value={form.email}
        onChange={(event) => setForm({ ...form, email: event.target.value })}
        style={input}
      />
      <input
        type="password"
        required
        minLength={8}
        autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        placeholder={flow === "signIn" ? "Password" : "Password (8+ characters)"}
        value={form.password}
        onChange={(event) => setForm({ ...form, password: event.target.value })}
        style={{ ...input, marginTop: "6px" }}
      />

      {error && (
        <p style={{ color: "#e5a3a3", fontSize: "12px", margin: "8px 0 0" }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <button type="submit" disabled={busy} style={{ ...primaryButton, flex: 1 }}>
          {busy ? "…" : flow === "signIn" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          style={secondaryButton}
          onClick={() => {
            setFlow(flow === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
        >
          {flow === "signIn" ? "Sign up" : "Have one"}
        </button>
      </div>
    </form>
  );
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const mutedText: React.CSSProperties = {
  color: "#8c8c8c",
  fontSize: "12px",
  lineHeight: "17px",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

const input: React.CSSProperties = {
  width: "100%",
  background: "rgba(0, 0, 0, 0.35)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "4px",
  color: "#fff",
  padding: "8px 10px",
  fontSize: "13px",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  background: "#fff",
  color: "#141414",
  border: "none",
  borderRadius: "4px",
  padding: "8px 14px",
  fontSize: "13px",
  fontFamily: "inherit",
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  background: "transparent",
  color: "#d2d2d2",
  border: "1px solid rgba(255, 255, 255, 0.25)",
  borderRadius: "4px",
  padding: "8px 14px",
  fontSize: "13px",
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default AuthPanel;
