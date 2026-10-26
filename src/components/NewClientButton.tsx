"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";

export default function NewClientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!f.first_name.trim()) return setError("Wpisz imię.");
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    const { data, error } = await createClient().from("clients").insert(row).select("id").single();
    if (error) return setError(errText(error));
    router.push(`/panel/klientki/${data.id}`);
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>+ Nowa klientka</button>
      {open && (
        <Modal
          title="Nowa klientka"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn-primary" onClick={save}>Zapisz</button>
              <button className="btn-ghost" onClick={() => setOpen(false)}>Anuluj</button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["first_name", "Imię *", "text"],
                ["last_name", "Nazwisko", "text"],
                ["phone", "Telefon", "tel"],
                ["email", "E-mail", "email"],
              ] as const
            ).map(([k, l, t]) => (
              <div key={k}>
                <label className="label" htmlFor={`nc-${k}`}>{l}</label>
                <input id={`nc-${k}`} type={t} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <ErrorBox error={error} />
        </Modal>
      )}
    </>
  );
}
