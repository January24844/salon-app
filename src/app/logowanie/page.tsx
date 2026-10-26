"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(
        error.message.includes("Invalid login")
          ? "Nieprawidłowy e-mail lub hasło."
          : `Nie udało się zalogować: ${error.message}`,
      );
      setBusy(false);
      return;
    }
    router.replace("/panel");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Panel salonu</p>
        <h1 className="mt-1 font-serif text-3xl">Zaloguj się</h1>

        <label className="mt-6 block text-sm font-medium" htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mt-1"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="password">Hasło</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mt-1"
        />

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
          {busy ? "Logowanie…" : "Zaloguj"}
        </button>
      </form>
    </main>
  );
}
