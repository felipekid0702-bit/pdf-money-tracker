import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

interface BillingSessionValue {
  authenticated: boolean;
}

const BillingSessionContext = createContext<BillingSessionValue>({ authenticated: false });

export function useBillingSession(): BillingSessionValue {
  return useContext(BillingSessionContext);
}

export function BillingAccessProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/billing")
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível verificar o acesso de cobrança.");
        const result = (await response.json()) as { authenticated?: boolean };
        if (active) setAuthenticated(result.authenticated === true);
      })
      .catch((error: unknown) => {
        console.error("[billing-session]", error);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({ authenticated }), [authenticated]);
  return <BillingSessionContext.Provider value={value}>{children}</BillingSessionContext.Provider>;
}

export function BillingAccessControl() {
  const { authenticated } = useBillingSession();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setMessage("");
      try {
        const response = await fetch("/api/billing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "login", username, password }),
        });
        const result = (await response.json()) as { error?: string; authenticated?: boolean };
        if (!response.ok) throw new Error(result.error ?? "Falha ao entrar.");
        setPassword("");
        setMessage("Acesso autorizado para esta sessão.");
        window.location.reload();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível entrar.");
      } finally {
        setBusy(false);
      }
    },
    [password, username],
  );

  async function logout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Falha ao sair.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível encerrar a sessão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative shrink-0"
    >
      <summary className="cursor-pointer list-none rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-muted">
        {authenticated ? "Cobrança autorizada" : "Acesso de cobrança"}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-card p-4 shadow-lg">
        {authenticated ? (
          <div className="space-y-3">
            <p className="text-sm">Sessão de cobrança autenticada.</p>
            <button
              type="button"
              onClick={logout}
              disabled={busy}
              className="rounded-md border border-input px-3 py-2 text-sm disabled:opacity-60"
            >
              Encerrar sessão
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm font-medium">
              Entre para importar relatórios fiscais, contatos e enviar avisos.
            </p>
            <label className="block space-y-1 text-xs">
              <span>Usuário</span>
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span>Senha</span>
              <input
                autoComplete="current-password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <button
              disabled={busy}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Verificando…" : "Entrar"}
            </button>
          </form>
        )}
        {message && (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
