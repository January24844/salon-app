import { createClient } from "@/lib/supabase/server";

type Check = { label: string; ok: boolean; hint?: string };

async function runChecks(): Promise<{ salonName: string; checks: Check[] }> {
  const hasEnv = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const checks: Check[] = [
    {
      label: "Plik .env.local z kluczami Supabase",
      ok: hasEnv,
      hint: "Skopiuj .env.example jako .env.local i wklej adres oraz klucz z Supabase.",
    },
  ];
  if (!hasEnv) return { salonName: "Mój Salon", checks };

  const supabase = await createClient();
  const settings = await supabase.from("salon_settings").select("name").maybeSingle();
  checks.push({
    label: "Połączenie z bazą i założone tabele",
    ok: !settings.error,
    hint: settings.error
      ? `Uruchom plik supabase/schema.sql w Supabase → SQL Editor. (${settings.error.message})`
      : undefined,
  });

  const services = await supabase.from("services").select("id", { count: "exact", head: true });
  checks.push({
    label: "Dodane zabiegi",
    ok: !services.error && (services.count ?? 0) > 0,
    hint: "Na razie pusto – zabiegi dodamy w następnym kroku.",
  });

  checks.push({
    label: "SMS (SMSAPI) – etap 2",
    ok: Boolean(process.env.SMSAPI_TOKEN),
    hint: "Opcjonalne na start.",
  });
  checks.push({
    label: "E-mail (Resend) – etap 2",
    ok: Boolean(process.env.RESEND_API_KEY),
    hint: "Opcjonalne na start.",
  });

  return { salonName: settings.data?.name ?? "Mój Salon", checks };
}

export default async function Home() {
  const { salonName, checks } = await runChecks();
  const required = checks.slice(0, 2);
  const ready = required.every((c) => c.ok);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
      <p className="text-sm uppercase tracking-[0.2em] text-muted">Konfiguracja</p>
      <h1 className="mt-2 font-serif text-4xl">{salonName}</h1>
      <p className="mt-3 text-muted">
        {ready
          ? "Wszystko podłączone – możesz przejść do panelu (/panel)."
          : "Jeszcze kilka kroków – szczegóły w pliku SETUP.md."}
      </p>

      <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-3 p-4">
            <span
              aria-hidden
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sm ${
                c.ok ? "bg-accent text-white" : "bg-accent-soft text-muted"
              }`}
            >
              {c.ok ? "✓" : "·"}
            </span>
            <div>
              <p className="font-medium">{c.label}</p>
              {!c.ok && c.hint && <p className="mt-1 text-sm text-muted">{c.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
