"use client";

import type { PaymentMethod } from "@/lib/types";
import { money } from "@/lib/time";

export type PayLine = { method: string; amount: number };

/** Płatność: jedna lub kilka metod (np. część gotówką, część kartą). */
export default function PaymentLines({
  methods,
  lines,
  onChange,
  total,
}: {
  methods: PaymentMethod[];
  lines: PayLine[];
  onChange: (l: PayLine[]) => void;
  total: number;
}) {
  const paid = lines.reduce((n, l) => n + Number(l.amount || 0), 0);
  return (
    <div>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <select
              className="input flex-1"
              value={l.method}
              onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}
              aria-label="Metoda płatności"
            >
              {methods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                  {!m.counts_to_revenue ? " (poza utargiem)" : ""}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step={1}
              className="input w-28"
              value={l.amount}
              onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, amount: +e.target.value } : x)))}
              aria-label="Kwota"
            />
            <span className="text-sm text-muted">zł</span>
            {lines.length > 1 && (
              <button className="btn-ghost px-2" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Usuń">
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        className="mt-2 text-sm text-accent hover:underline"
        onClick={() => onChange([...lines, { method: "karta", amount: Math.max(0, Math.round((total - paid) * 100) / 100) }])}
      >
        + podziel płatność
      </button>
      {Math.abs(paid - total) > 0.009 && (
        <p className="mt-3 text-sm text-muted">
          Suma płatności: <strong>{money(paid)}</strong> (
          {paid < total ? `rabat ${money(total - paid)}` : `więcej o ${money(paid - total)}`}).
        </p>
      )}
    </div>
  );
}

/** Po zmianie kwoty do zapłaty dopasuj ostatnią płatność, żeby suma się zgadzała. */
export function rebalance(lines: PayLine[], total: number, fixedFirst = false): PayLine[] {
  if (!lines.length) return [{ method: "gotowka", amount: Math.max(0, total) }];
  const lastIdx = lines.length - 1;
  if (fixedFirst && lastIdx === 0) return lines;
  const others = lines.slice(0, lastIdx).reduce((n, l) => n + Number(l.amount || 0), 0);
  return lines.map((l, i) => (i === lastIdx ? { ...l, amount: Math.max(0, Math.round((total - others) * 100) / 100) } : l));
}
