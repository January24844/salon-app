"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorBox, errText } from "@/components/Modal";

type ClientRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  allergies: string | null;
  consent_reminders: boolean;
  consent_marketing_sms: boolean;
  consent_marketing_email: boolean;
};

export default function ClientCardForm({ client }: { client: ClientRow }) {
  const router = useRouter();
  const [f, setF] = useState(client);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ClientRow>(k: K, v: ClientRow[K]) => {
    setF({ ...f, [k]: v });
    setSaved(false);
  };

  async function save() {
    if (!f.first_name.trim()) return setError("Imię jest wymagane.");
    setBusy(true);
    setError(null);
    const consentChanged =
      f.consent_reminders !== client.consent_reminders ||
      f.consent_marketing_sms !== client.consent_marketing_sms ||
      f.consent_marketing_email !== client.consent_marketing_email;
    const { id, ...rest } = f;
    const row = {
      ...rest,
      first_name: f.first_name.trim(),
      last_name: f.last_name?.trim() || null,
      phone: f.phone?.trim() || null,
      email: f.email?.trim() || null,
      birth_date: f.birth_date || null,
      ...(consentChanged ? { consent_updated_at: new Date().toISOString() } : {}),
    };
    const { error } = await createClient().from("clients").update(row).eq("id", id);
    setBusy(false);
    if (error) return setError(errText(error));
    setSaved(true);
    router.refresh();
  }

  const text = (k: "first_name" | "last_name" | "phone" | "email", label: string, type = "text") => (
    <div>
      <label className="label" htmlFor={`cc-${k}`}>{label}</label>
      <input id={`cc-${k}`} type={type} className="input" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <section className="h-fit rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {text("first_name", "Imię")}
        {text("last_name", "Nazwisko")}
        {text("phone", "Telefon", "tel")}
        {text("email", "E-mail", "email")}
        <div>
          <label className="label" htmlFor="cc-birth">Data urodzenia</label>
          <input id="cc-birth" type="date" className="input" value={f.birth_date ?? ""} onChange={(e) => set("birth_date", e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <label className="label" htmlFor="cc-allergies">Alergie / przeciwwskazania</label>
        <textarea id="cc-allergies" rows={2} className="input" value={f.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} />
      </div>
      <div className="mt-3">
        <label className="label" htmlFor="cc-notes">Notatki salonu (klientka nie widzi)</label>
        <textarea id="cc-notes" rows={3} className="input" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <fieldset className="mt-4 space-y-1.5 text-sm">
        <legend className="label">Zgody</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.consent_reminders} onChange={(e) => set("consent_reminders", e.target.checked)} />
          Przypomnienia o wizytach (SMS / e-mail)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.consent_marketing_sms} onChange={(e) => set("consent_marketing_sms", e.target.checked)} />
          Marketing SMS (promocje, nowości)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.consent_marketing_email} onChange={(e) => set("consent_marketing_email", e.target.checked)} />
          Marketing e-mail
        </label>
      </fieldset>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz"}</button>
        {saved && <span className="text-sm text-muted">Zapisano ✓</span>}
      </div>
      <ErrorBox error={error} />
    </section>
  );
}
