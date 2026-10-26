"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type { Category, Service } from "@/lib/types";
import { norm } from "@/lib/types";
import { money } from "@/lib/time";

export default function ServiceManager({
  services,
  categories,
  canEdit,
}: {
  services: Service[];
  categories: Category[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const visible = services.filter((s) => words.every((w) => norm(s.name).includes(w)));

  // kategorie w kolejności: nadrzędna, potem jej podkategorie
  const ordered = useMemo(() => {
    const out: { cat: Category; depth: number }[] = [];
    for (const c of categories.filter((c) => !c.parent_id)) {
      out.push({ cat: c, depth: 0 });
      for (const sub of categories.filter((x) => x.parent_id === c.id)) out.push({ cat: sub, depth: 1 });
    }
    return out;
  }, [categories]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 font-serif text-3xl">Zabiegi</h1>
        <input className="input w-64" placeholder="szukaj zabiegu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
        {canEdit && <button className="btn-primary" onClick={() => setEditing("new")}>+ Dodaj zabieg</button>}
      </div>

      {ordered.map(({ cat, depth }) => {
        const list = visible.filter((s) => s.category_id === cat.id);
        const hasChildren = categories.some((c) => c.parent_id === cat.id);
        if (!list.length && (words.length || !hasChildren)) return null;
        return (
          <section key={cat.id} className="mb-5">
            <h2 className={depth === 0 ? "mb-2 font-serif text-xl" : "mb-2 text-sm font-semibold uppercase tracking-wide text-muted"}>{cat.name}</h2>
            {list.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {list.map((s) => (
                  <li key={s.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${s.active ? "" : "opacity-50"}`}>
                    <span className="min-w-0 flex-1">
                      {s.name}
                      {s.package_sessions > 1 && (
                        <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs">pakiet {s.package_sessions}×</span>
                      )}
                      {!s.active && <span className="ml-2 text-xs text-muted">(ukryty)</span>}
                    </span>
                    <span className="whitespace-nowrap text-muted">{s.duration_minutes} min</span>
                    <span className="w-24 whitespace-nowrap text-right font-medium">{money(s.price)}</span>
                    {canEdit && <button className="btn-ghost px-2 text-sm" onClick={() => setEditing(s)}>Edytuj</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {!canEdit && <p className="text-xs text-muted">Zmieniać cennik może właścicielka.</p>}

      {editing && (
        <ServiceForm
          service={editing === "new" ? null : editing}
          categories={ordered}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ServiceForm({
  service,
  categories,
  onClose,
  onSaved,
}: {
  service: Service | null;
  categories: { cat: Category; depth: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: service?.name ?? "",
    category_id: service?.category_id ?? categories[0]?.cat.id ?? "",
    duration_minutes: service?.duration_minutes ?? 30,
    price: service ? Number(service.price) : 0,
    package_sessions: service?.package_sessions ?? 1,
    active: service?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return setError("Wpisz nazwę zabiegu.");
    setBusy(true);
    const supabase = createClient();
    const row = { ...f, name: f.name.trim(), category_id: f.category_id || null };
    const res = service
      ? await supabase.from("services").update(row).eq("id", service.id)
      : await supabase.from("services").insert({ ...row, sort_order: 9999 });
    setBusy(false);
    if (res.error) return setError(errText(res.error));
    onSaved();
  }

  return (
    <Modal
      title={service ? "Edycja zabiegu" : "Nowy zabieg"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="sv-name">Nazwa</label>
          <input id="sv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="sv-cat">Kategoria</label>
          <select id="sv-cat" className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            {categories.map(({ cat, depth }) => (
              <option key={cat.id} value={cat.id}>{depth ? "   — " : ""}{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="sv-dur">Czas (min)</label>
            <input id="sv-dur" type="number" min={5} step={5} className="input" value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: +e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="sv-price">Cena (zł)</label>
            <input id="sv-price" type="number" min={0} step={10} className="input" value={f.price} onChange={(e) => setF({ ...f, price: +e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="sv-pack">Wizyt w pakiecie</label>
            <input id="sv-pack" type="number" min={1} className="input" value={f.package_sessions} onChange={(e) => setF({ ...f, package_sessions: Math.max(1, +e.target.value) })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Aktywny (widoczny przy umawianiu)
        </label>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
