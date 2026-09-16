import { usePrivy, useLoginWithOAuth, useLoginWithPasskey } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { DiscordIcon, FarcasterIcon, GithubIcon, GoogleIcon, XIcon } from "./provider-icons";

/**
 * Social sign-in row. Google/GitHub/Discord/X go straight to their OAuth
 * redirect (no modal); Farcaster runs through Privy's SIWF flow inside the
 * Privy modal. Each provider must also be enabled for the app in the Privy
 * dashboard before its flow will complete.
 */
type SocialKey = "google" | "github" | "discord" | "twitter" | "farcaster";

type WalletBalances = {
  usdc: number;
  eth: string;
  network: string;
  faucet: { claimed: boolean; amount: number | null; txHash: string | null };
  ready: boolean;
};

const SOCIAL_BUTTONS: { key: SocialKey; label: string; Icon: ComponentType }[] = [
  { key: "google", label: "Continue with Google", Icon: GoogleIcon },
  { key: "github", label: "Continue with GitHub", Icon: GithubIcon },
  { key: "discord", label: "Continue with Discord", Icon: DiscordIcon },
  { key: "twitter", label: "Continue with X", Icon: XIcon },
  { key: "farcaster", label: "Continue with Farcaster", Icon: FarcasterIcon },
];

/**
 * The workspace identity block. Sign-in/sign-up via Privy (email, social
 * providers, passkey); the account's embedded wallet becomes the settlement
 * address for the agent grid later. Rendered client-only through
 * WorkspaceAuthShell.
 */
export function WorkspaceAuth() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth();
  const { loginWithPasskey } = useLoginWithPasskey();

  const email = user?.email?.address ?? null;
  const wallet = user?.wallet?.address ?? null;
  const uid = email ?? wallet ?? "user";
  const storageKey = `pl.workspace.${uid}`;
  const faucetKey = `pl.faucet.${wallet ?? ""}`;

  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState(false);
  const [busyMethod, setBusyMethod] = useState<SocialKey | "passkey" | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [faucetState, setFaucetState] = useState<
    "idle" | "claiming" | "claimed" | "already" | "error"
  >("idle");
  const [faucetNote, setFaucetNote] = useState<string | null>(null);
  const faucetAttempted = useRef(false);

  const refreshBalances = useCallback(async (address: string) => {
    try {
      const res = await fetch(`/api/wallet/balance?wallet=${encodeURIComponent(address)}`);
      if (!res.ok) return;
      const data = (await res.json()) as WalletBalances;
      setBalances(data);
    } catch {
      // network blip — keep last known
    }
  }, []);

  const runFaucet = useCallback(
    async (address: string, identity: string) => {
      if (faucetAttempted.current) return;
      faucetAttempted.current = true;
      setFaucetState("claiming");
      try {
        const res = await fetch("/api/wallet/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address, identity }),
        });
        const data = (await res.json()) as
          | { ok: true; alreadyClaimed: boolean; txHash: string; amount: number }
          | { ok: false; error: string };
        if (!res.ok || !("ok" in data) || !data.ok) {
          setFaucetState("error");
          setFaucetNote("error" in data ? String(data.error).slice(0, 80) : "faucet failed");
          return;
        }
        setFaucetState(data.alreadyClaimed ? "already" : "claimed");
        setFaucetNote(`${data.amount} USDC · ${data.txHash.slice(0, 10)}…`);
        try {
          window.localStorage.setItem(faucetKey, data.txHash);
        } catch {
          // private browsing
        }
      } catch {
        setFaucetState("error");
        setFaucetNote("faucet unreachable");
      }
    },
    [faucetKey],
  );

  useEffect(() => {
    try {
      setLabel(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      setLabel("");
    }
  }, [storageKey]);

  useEffect(() => {
    if (!authenticated || !wallet) return;
    void refreshBalances(wallet);
    // First login on this wallet → claim 2 USDC once.
    let claimed = false;
    try {
      claimed = Boolean(window.localStorage.getItem(faucetKey));
    } catch {
      claimed = false;
    }
    if (!claimed) {
      void runFaucet(wallet, uid);
    } else {
      setFaucetState("already");
    }
    const timer = window.setInterval(() => void refreshBalances(wallet), 20_000);
    return () => window.clearInterval(timer);
  }, [authenticated, wallet, uid, faucetKey, refreshBalances, runFaucet]);

  if (!ready) {
    return (
      <div className="app-workspace-block">
        <p className="label-mono">Workspace</p>
        <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
          Checking session…
        </p>
      </div>
    );
  }

  if (!authenticated) {
    const socialBusy = busyMethod !== null || oauthLoading;

    const handleSocial = (key: SocialKey) => {
      setBusyMethod(key);
      if (key !== "farcaster") {
        // Headless OAuth. Full-page redirect to the provider.
        initOAuth({ provider: key })
          .catch(() => {
            // User closed the redirect or the provider errored; stay signed out.
          })
          .finally(() => setBusyMethod(null));
        return;
      }
      // Farcaster: SIWF inside the Privy modal, scoped to that one method.
      try {
        login({ loginMethods: ["farcaster"] });
      } finally {
        // The modal owns the flow from here; clear the pressed state so a
        // closed modal doesn't leave a stuck spinner.
        window.setTimeout(() => setBusyMethod(null), 1500);
      }
    };

    const handlePasskey = () => {
      setBusyMethod("passkey");
      loginWithPasskey()
        .catch(() => {
          // Cancelled or no passkey on this device.
        })
        .finally(() => setBusyMethod(null));
    };

    return (
      <div className="app-workspace-block">
        <p className="label-mono">Workspace</p>
        <p className="mt-1 text-sm text-ink">Your workspace</p>
        <button
          type="button"
          onClick={() => login()}
          className="mt-2 w-full inline-flex items-center justify-center rounded-sm border border-signal px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-signal transition-colors hover:bg-signal hover:text-ink"
        >
          Sign in / Sign up
        </button>

        <div className="mt-3 flex items-center gap-2" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-muted">
            or
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {SOCIAL_BUTTONS.map(({ key, label: providerLabel, Icon }) => (
            <button
              key={key}
              type="button"
              title={providerLabel}
              aria-label={providerLabel}
              disabled={socialBusy}
              onClick={() => handleSocial(key)}
              className="flex h-8 items-center justify-center rounded-sm border border-input text-ink-muted transition-colors hover:border-signal hover:text-signal focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyMethod === key ? (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                />
              ) : (
                <Icon />
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handlePasskey}
          disabled={socialBusy}
          className="mt-2 font-mono text-[0.62rem] text-ink-muted underline-offset-2 hover:text-signal hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyMethod === "passkey" ? "Waiting for passkey…" : "Use a passkey instead"}
        </button>
      </div>
    );
  }

  const displayName =
    label.trim().length > 0 ? label.trim() : (email?.split("@")[0] ?? "Your workspace");

  return (
    <div className="app-workspace-block">
      <p className="label-mono">Workspace</p>
      {editing ? (
        <form
          className="mt-1"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              window.localStorage.setItem(storageKey, label);
            } catch {
              // private browsing: keep the label in memory only
            }
            setEditing(false);
          }}
        >
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Company or your name"
            autoFocus
            maxLength={60}
            aria-label="Workspace name"
            className="w-full rounded-sm border border-input bg-card px-2 py-1 text-sm text-ink placeholder:text-ink-muted"
          />
          <button
            type="submit"
            className="mt-1.5 rounded-sm bg-signal px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-ink"
          >
            Save
          </button>
        </form>
      ) : (
        <>
          <p className="mt-1 truncate text-sm text-ink">{displayName}</p>
        </>
      )}
      {email && (
        <p className="truncate font-mono text-[0.62rem] text-ink-muted" title={email}>
          {email}
        </p>
      )}
      {wallet && (
        <div className="mt-2 rounded-sm border border-border bg-card/60 px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-mono text-muted-foreground">Base USDC</span>
            <span className="font-mono text-sm text-ink tabular-nums">
              {balances ? `${balances.usdc.toFixed(2)}` : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="label-mono text-muted-foreground">ETH gas</span>
            <span className="font-mono text-[0.66rem] text-ink-muted tabular-nums">
              {balances ? Number(balances.eth).toFixed(4) : "—"}
            </span>
          </div>
          <p className="mt-1.5 truncate font-mono text-[0.58rem] text-ink-muted" title={wallet}>
            {wallet.slice(0, 6)}…{wallet.slice(-4)}
            {balances?.network ? ` · ${balances.network}` : ""}
          </p>
          <p className="mt-1 font-mono text-[0.58rem] text-ink-muted">
            {faucetState === "claiming"
              ? "Funding 2 USDC…"
              : faucetState === "claimed"
                ? `Faucet sent · ${faucetNote ?? ""}`
                : faucetState === "already"
                  ? balances?.faucet.txHash
                    ? `Faucet claimed · ${balances.faucet.txHash.slice(0, 10)}…`
                    : "Faucet already claimed"
                  : faucetState === "error"
                    ? `Faucet: ${faucetNote ?? "failed"}`
                    : "2 USDC on first login · enough for 2 runs"}
          </p>
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-mono text-[0.62rem] text-ink-muted underline-offset-2 hover:text-signal hover:underline"
        >
          Rename
        </button>
        <span aria-hidden="true" className="font-mono text-[0.62rem] text-ink-muted">
          ·
        </span>
        <button
          type="button"
          onClick={() => logout()}
          className="font-mono text-[0.62rem] text-ink-muted underline-offset-2 hover:text-signal hover:underline"
        >
          Sign out
        </button>
      </div>
      {(email ?? wallet) && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("agentos:open"))}
            className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-signal underline-offset-2 hover:underline"
          >
            Watch holdings
          </button>
        </div>
      )}
    </div>
  );
}
