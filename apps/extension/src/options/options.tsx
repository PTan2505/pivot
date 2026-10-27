import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, DEFAULT_SERVER, getConfig, setConfig } from "../lib/api";
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
        <h1 className="text-base font-semibold">Stan Bag extension</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Find both values in Stan Bag › <span className="text-foreground">Settings › Browser extension</span>. The token lets this extension add to your library; other websites can’t.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveAndTest();
        }}
      >
        <Field label="Server URL" htmlFor="server">
          <Input id="server" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} className="font-mono text-xs" />
        </Field>
        <Field label="API token" htmlFor="token">
          <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono text-xs" autoComplete="off" />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={state.kind === "testing"}>
            {state.kind === "testing" && <Loader2 className="animate-spin" />} Save & test
          </Button>
          {state.kind === "ok" && (
            <span role="status" className="flex items-center gap-1.5 text-xs text-emerald-500">
              <Check className="size-3.5" /> {state.message}
            </span>
          )}
          {state.kind === "error" && (
            <span role="alert" className="flex items-center gap-1.5 text-xs text-primary">
              <X className="size-3.5" /> {state.message}
            </span>
          )}
        </div>
      </form>
      <section className="space-y-2 border-t border-border pt-6 text-sm">
        <h2 className="font-medium">How to save</h2>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>
            <kbd className="font-mono text-foreground">⌥⇧S</kbd> or the toolbar button — save the tab with a screenshot of what you see, add tags and notes.
          </li>
          <li>
            <kbd className="font-mono text-foreground">⌥⇧D</kbd> — quick-save the tab without the popup.
          </li>
          <li>Right-click a page, link or image → “Save … to Stan Bag”.</li>
          <li>Select text, right-click → save it as a snippet or prompt.</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Change shortcuts at <code className="font-mono">chrome://extensions/shortcuts</code>.
        </p>
      </section>
    </main>
  );
}
