import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, DEFAULT_SERVER, getConfig, setConfig } from "../lib/api";
import { pendingStore } from "../lib/pending-store";
import { exportPending, importPending, readTransfer, type TransferFile } from "../lib/transfer";
import { Button, Field, Input, Logo } from "../ui";

export function Options() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "testing" | "ok" | "error"; message?: string }>({ kind: "idle" });

  useEffect(() => {
    getConfig().then((c) => {
      setServerUrl(c.serverUrl);
      setToken(c.token);
    });
  }, []);

  const saveAndTest = async () => {
    const config = { serverUrl: serverUrl.trim().replace(/\/+$/, "") || DEFAULT_SERVER, token: token.trim() };
    await setConfig(config);
    setState({ kind: "testing" });
    try {
      await api.check(config);
      setState({ kind: "ok", message: "Connected. You can close this tab." });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-12">
      <div className="flex items-center gap-2">
        <Logo />
        <h1 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">PIVOT extension</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Find both values in PIVOT › <span className="text-ink">Settings › Browser extension</span>. The token lets this
        extension add to your library; other websites can’t.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveAndTest();
        }}
      >
        <Field label="Server URL" htmlFor="server">
          <Input
            id="server"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="API token" htmlFor="token">
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-xs"
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={state.kind === "testing"}>
            {state.kind === "testing" && <Loader2 className="animate-spin" />} Save & test
          </Button>
          {state.kind === "ok" && (
            <span role="status" className="flex items-center gap-1.5 text-xs text-success">
              <Check className="size-3.5" /> {state.message}
            </span>
          )}
          {state.kind === "error" && (
            <span role="alert" className="flex items-center gap-1.5 text-xs text-danger">
              <X className="size-3.5" /> {state.message}
            </span>
          )}
        </div>
      </form>
      <section className="space-y-2 border-t border-divider pt-6 text-sm">
        <h2 className="font-medium">How to save</h2>
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li>
            <kbd className="font-mono text-ink">⌥⇧S</kbd> or the toolbar button — save the tab with a screenshot of what
            you see, add tags and notes.
          </li>
          <li>
            <kbd className="font-mono text-ink">⌥⇧D</kbd> — quick-save the tab without the popup.
          </li>
          <li>Right-click a page, link or image → “Save … to PIVOT”.</li>
          <li>Select text, right-click → save it as a snippet or prompt.</li>
        </ul>
        <p className="text-xs text-ink-muted">
          Change shortcuts at <code className="font-mono">chrome://extensions/shortcuts</code>.
        </p>
      </section>
      <WaitingSaves />
    </main>
  );
}

/**
 * Moving to another computer, or reinstalling: saves still waiting on this one go with you as a file. The extension
 * can't stop an uninstall, so export first; once removed, waiting saves are gone. The token stays here.
 */
function WaitingSaves() {
  const [count, setCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<{ file: TransferFile; total: number; alreadyHere: number } | null>(null);
  useEffect(() => {
    void pendingStore.count().then(setCount);
  }, []);
  const download = async () => {
    const { serverUrl } = await getConfig();
    const blob = await exportPending(serverUrl);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pivot-waiting-saves-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMessage("Downloaded. Keep it somewhere safe: it holds the screenshots of these saves.");
  };
  return (
    <section className="space-y-2 border-t border-divider pt-6 text-sm">
      <h2 className="font-medium">Waiting saves</h2>
      <p className="text-xs text-ink-muted">
        {count === null
          ? "…"
          : count
            ? `${count} save${count > 1 ? "s are" : " is"} waiting on this computer. Before you move to another computer or remove the extension, export them; then import the file there.`
            : "Nothing is waiting on this computer."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!count} onClick={download}>
          Export waiting saves
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-full bg-surface px-4 text-[13px] font-medium text-ink-secondary hover:bg-surface-raised hover:text-ink">
          Import a file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setIncoming(await readTransfer(await f.text()));
                setMessage(null);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </label>
      </div>
      {incoming && (
        <div className="space-y-2 rounded-[12px] bg-surface p-3 text-xs">
          <p>
            {incoming.total} save{incoming.total > 1 ? "s" : ""} in the file
            {incoming.alreadyHere ? `, ${incoming.alreadyHere} already here (skipped)` : ""}. They will be sent like any
            waiting save; ones waiting for privacy approval still wait.
          </p>
          <Button
            onClick={async () => {
              const added = await importPending(incoming.file);
              setIncoming(null);
              setCount(await pendingStore.count());
              setMessage(`Imported ${added}.`);
              void chrome.runtime.sendMessage({ type: "pivot:queue-changed" }).catch(() => {});
            }}
          >
            Import {incoming.total - incoming.alreadyHere}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-xs text-ink-muted">
          {message}
        </p>
      )}
    </section>
  );
}
