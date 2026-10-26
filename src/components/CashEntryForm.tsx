"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorBox, errText } from "@/components/Modal";

export default function CashEntryForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!(Number(amount) > 0) || !description.trim()) return setError("Wpisz kwotę i opis.");
    const { error } = await createClient()
      .from("cash_entries")
      .insert({ direction, amount: Number(amount), description: description.trim() });
    if (error) return setError(errText(error));
    setAmount("");
    setDescription("");
    setError(null);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className="mt-3 text-sm text-accent hover:underline" onClick={() => setOpen(true)}>
        + Dodaj wydatek / wpływ do kasy
      </button>
    );

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} aria-label="Rodzaj">
          <option value="out">wydatek</option>
          <option value="in">wpływ</option>
        </select>
        <input type="number" min={0} step={1} className="input w-28" placeholder="kwota" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Kwota" />
        <input className="input min-w-40 flex-1" placeholder="opis, np. zakupy, wymiana" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Opis" />
        <button className="btn-primary" onClick={save}>Dodaj</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Anuluj</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
