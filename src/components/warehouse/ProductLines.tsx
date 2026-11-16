"use client";

import { useMemo, useState } from "react";
import type { Product, SaleLine } from "@/lib/types";
import { norm, qtyFmt } from "@/lib/types";
import { money } from "@/lib/time";

/** Wybór produktów do sprzedaży: wyszukiwarka + lista z ilością i ceną. */
export default function ProductLines({
  products,
  lines,
  onChange,
}: {
  products: Product[];
  lines: SaleLine[];
  onChange: (lines: SaleLine[]) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return products
      .filter((p) => p.active && p.kind !== "material")
      .filter((p) => words.every((w) => norm(p.name).includes(w)))
      .slice(0, 30);
  }, [q, products]);

  function add(p: Product) {
    const existing = lines.findIndex((l) => l.product_id === p.id);
    if (existing >= 0) onChange(lines.map((l, i) => (i === existing ? { ...l, qty: l.qty + 1 } : l)));
    else onChange([...lines, { product_id: p.id, name: p.name, qty: 1, price: Number(p.price), stock: Number(p.stock) }]);
    setQ("");
    setOpen(false);
  }

  return (
    <div>
      <div className="relative">
        <input
          className="input"
          placeholder="wpisz nazwę produktu"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Szukaj produktu"
        />
        {open && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(p)}
                >
                  <span className="min-w-0 flex-1">{p.name}</span>
                  <span className={`whitespace-nowrap text-xs ${Number(p.stock) > 0 ? "text-muted" : "text-red-600"}`}>
                    stan: {qtyFmt(p.stock)}
                  </span>
                  <span className="whitespace-nowrap font-medium">{money(p.price)}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nie znaleziono produktu.</li>}
          </ul>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {lines.map((l, i) => (
            <li key={l.product_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {l.name}
                {l.qty > l.stock && (
                  <span className="block text-xs text-amber-700 dark:text-amber-300">
                    Na stanie tylko {qtyFmt(l.stock)} – stan zejdzie poniżej zera.
                  </span>
                )}
              </span>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input w-16 px-2 py-1"
                  value={l.qty}
                  onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, +e.target.value) } : x)))}
                  aria-label="Ilość"
                />
                szt.
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="input w-20 px-2 py-1"
                  value={l.price}
                  onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)))}
                  aria-label="Cena za sztukę"
                />
                zł
              </label>
              <button className="btn-ghost px-2 py-1" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Usuń produkt">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const linesTotal = (lines: SaleLine[]) => lines.reduce((n, l) => n + l.qty * l.price, 0);
