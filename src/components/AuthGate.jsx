import { useEffect, useState } from "react";
import { api, mutation, setSession } from "../lib/api";
export default function AuthGate({ children }) {
  const [session, setAuth] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api("/auth/session")
      .then((s) => {
        if (live) {
          setSession(s);
          setAuth(s);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const expired = () => {
      setSession(null);
      setAuth({ authenticated: false });
    };
    window.addEventListener("session-expired", expired);
    return () => {
      live = false;
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  if (session?.authenticated)
    return (
      <>
        <div className="session-bar">
          {session.username}
          <button
            onClick={async () => {
              await mutation("/auth/logout");
              setSession(null);
              setAuth({ authenticated: false });
            }}
          >
            Sair da sessão
          </button>
        </div>
        {children}
      </>
    );
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form
        className="panel space-y-5 w-full max-w-md"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            const s = await mutation("/auth/login", {
              username: data.get("username"),
              password: data.get("password"),
            });
            setSession(s);
            setAuth(s);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-3xl font-bold">
          Wapp<span className="text-emerald-400">GR</span>
        </h1>
        <p>Acesse sua operação de mensagens.</p>
        {session?.needsSetup && (
          <p className="notice">
            Primeiro acesso: no terminal do projeto execute{" "}
            <code>npm run setup-admin</code> para criar seu usuário e senha.
          </p>
        )}
        <label className="field">
          Usuário
          <input name="username" autoComplete="username" required />
        </label>
        <label className="field">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="btn primary w-full" disabled={busy || !session}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
