"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import ProductLines, { linesTotal } from "./ProductLines";
import PaymentLines, { rebalance, type PayLine } from "./PaymentLines";
import type {
  ClientLite,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductKind,
  SaleLine,
  Staff,
  StockMovement,
} from "@/lib/types";
import { KIND_LABEL, REASON_LABEL, clientName, norm, qtyFmt } from "@/lib/types";
import { formatDayShort, money, toZoned } from "@/lib/time";

type Dialog =
  | { kind: "product"; product: Product | null }
  | { kind: "stock"; product: Product; mode: "dostawa" | "korekta" | "zuzycie" }
  | { kind: "sale"; product?: Product }
  | null;

export default function WarehouseView({
  products,
  categories,
  movements,
  staff,
  methods,
  isOwner,
}: {
  products: Product[];
  categories: ProductCategory[];
  movements: StockMovement[];
  staff: Staff[];
  methods: PaymentMethod[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"produkty" | "historia">("produkty");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const visible = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return products
      .filter((p) => showInactive || p.active)
      .filter((p) => !cat || (cat === "-" ? !p.category_id : p.category_id === cat))
      .filter((p) => !onlyStock || Number(p.stock) > 0)
      .filter((p) => words.every((w) => norm([p.name, p.sku].filter(Boolean).join(" ")).includes(w)));
  }, [products, q, cat, onlyStock, showInactive]);

  const stockValue = products.reduce((n, p) => n + Math.max(0, Number(p.stock)) * Number(p.price), 0);
  const low = products.filter((p) => p.active && p.min_stock !== null && Number(p.stock) <= Number(p.min_stock)).length;

  const done = () => {
    setDialog(null);
    router.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-2 font-serif text-3xl">Magazyn</h1>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {(["produkty", "historia"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
            >
              {t === "historia" ? "Historia ruchów" : "Produkty"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setDialog({ kind: "product", product: null })}>+ Produkt</button>
          <button className="btn-primary" onClick={() => setDialog({ kind: "sale" })}>Sprzedaż</button>
        </div>
      </div>

      {tab === "produkty" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className="input w-64" placeholder="szukaj produktu lub kodu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
            <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Kategoria">
              <option value="">wszystkie kategorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="-">bez kategorii</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />
              tylko na stanie
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              pokaż ukryte
            </label>
            <span className="ml-auto text-sm text-muted">
              {visible.length} z {products.filter((p) => p.active).length} produktów
              {low > 0 && <span className="ml-2 text-amber-700 dark:text-amber-300">· {low} kończy się</span>}
              {isOwner && <span className="ml-2">· wartość stanu {money(stockValue)}</span>}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-accent-soft text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Nazwa</th>
                  <th className="px-3 py-2 font-medium">Kategoria</th>
                  <th className="px-3 py-2 font-medium">Rodzaj</th>
                  <th className="px-3 py-2 text-right font-medium">Stan</th>
                  <th className="px-3 py-2 text-right font-medium">Cena</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((p) => {
                  const st = Number(p.stock);
                  const isLow = p.min_stock !== null && st <= Number(p.min_stock);
                  return (
                    <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{p.name}</span>
                        {p.sku && <span className="ml-2 text-xs text-muted">{p.sku}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted">{p.category_id ? catName.get(p.category_id) : "—"}</td>
                      <td className="px-3 py-2 text-muted">{KIND_LABEL[p.kind]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            st <= 0
                              ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                              : isLow
                                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                : ""
                          }`}
                        >
                          {qtyFmt(st)} op.
                        </span>
                        {p.capacity_ml ? <span className="ml-1 text-xs text-muted">({qtyFmt(Math.max(0, st) * Number(p.capacity_ml))} ml)</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(p.price)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "stock", product: p, mode: "dostawa" })}>Przyjmij</button>
                        {p.kind !== "material" && (
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "sale", product: p })}>Sprzedaj</button>
                        )}
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "stock", product: p, mode: "korekta" })}>Korekta</button>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "product", product: p })}>Edytuj</button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted">Brak produktów.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-accent-soft text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Produkt</th>
                <th className="px-3 py-2 font-medium">Rodzaj ruchu</th>
                <th className="px-3 py-2 text-right font-medium">Zmiana</th>
                <th className="px-3 py-2 text-right font-medium">Cena</th>
                <th className="px-3 py-2 font-medium">Klientka / pracownica</th>
                <th className="px-3 py-2 font-medium">Uwagi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.map((m) => {
                const z = toZoned(m.created_at);
                const ch = Number(m.change);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDayShort(z.date)} {z.time}</td>
                    <td className="px-3 py-2">{m.product?.name}</td>
                    <td className="px-3 py-2">
                      {REASON_LABEL[m.reason]}
                      {m.appointment_id && <span className="text-muted"> (przy wizycie)</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${ch < 0 ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"}`}>
                      {ch > 0 ? "+" : ""}
                      {qtyFmt(ch)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.unit_price !== null ? money(m.unit_price) : ""}</td>
                    <td className="px-3 py-2 text-muted">
                      {[m.client ? clientName(m.client) : null, m.staff?.full_name].filter(Boolean).join(" · ")}
                    </td>
                    <td className="px-3 py-2 text-muted">{m.note}</td>
                  </tr>
                );
              })}
              {movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">Brak ruchów magazynowych.</td>
                </tr>
              )}
            </tbody>
          </table>
          {movements.length >= 300 && <p className="px-3 py-2 text-xs text-muted">Pokazano 300 ostatnich ruchów.</p>}
        </div>
      )}

      {dialog?.kind === "product" && (
        <ProductForm product={dialog.product} categories={categories} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "stock" && (
        <StockDialog product={dialog.product} initialMode={dialog.mode} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "sale" && (
        <SaleDialog
          products={products}
          staff={staff}
          methods={methods}
          initial={dialog.product}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
    </div>
  );
}

/* ---------------- Produkt: dodawanie / edycja ---------------- */

function ProductForm({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: ProductCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: product?.name ?? "",
    category_id: product?.category_id ?? "",
    kind: (product?.kind ?? "towar") as ProductKind,
    sku: product?.sku ?? "",
    capacity_ml: product?.capacity_ml ? String(product.capacity_ml) : "",
    price: product ? String(product.price) : "",
    min_stock: product?.min_stock !== null && product?.min_stock !== undefined ? String(product.min_stock) : "",
    active: product?.active ?? true,
  });
  const [newCat, setNewCat] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return setError("Wpisz nazwę produktu.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let categoryId: string | null = f.category_id || null;
    if (f.category_id === "__new") {
      if (!newCat.trim()) {
        setBusy(false);
        return setError("Wpisz nazwę nowej kategorii.");
      }
      const { data, error } = await supabase
        .from("product_categories")
        .upsert({ name: newCat.trim() }, { onConflict: "name" })
        .select("id")
        .single();
      if (error) return fail(error);
      categoryId = data.id as string;
    }
    const row = {
      name: f.name.trim(),
      category_id: categoryId,
      kind: f.kind,
      sku: f.sku.trim() || null,
      capacity_ml: f.capacity_ml ? Number(f.capacity_ml) : null,
      price: Number(f.price) || 0,
      min_stock: f.min_stock === "" ? null : Number(f.min_stock),
      active: f.active,
    };
    if (product) {
      const { error } = await supabase.from("products").update(row).eq("id", product.id);
      if (error) return fail(error);
    } else {
      const { data, error } = await supabase.from("products").insert(row).select("id").single();
      if (error) return fail(error);
      if (Number(initialStock) > 0) {
        const mv = await supabase
          .from("stock_movements")
          .insert({ product_id: data.id, change: Number(initialStock), reason: "dostawa", note: "stan początkowy" });
        if (mv.error) return fail(mv.error);
      }
    }
    onSaved();
  }
  function fail(e: unknown) {
    setBusy(false);
    setError(errText(e));
  }

  return (
    <Modal
      title={product ? "Edycja produktu" : "Nowy produkt"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="pr-name">Nazwa</label>
          <input id="pr-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pr-cat">Kategoria</label>
            <select id="pr-cat" className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">brak kategorii</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__new">+ nowa kategoria…</option>
            </select>
            {f.category_id === "__new" && (
              <input className="input mt-2" placeholder="nazwa kategorii, np. Lycon" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Nowa kategoria" />
            )}
          </div>
          <div>
            <label className="label" htmlFor="pr-kind">Rodzaj</label>
            <select id="pr-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ProductKind })}>
              <option value="towar">towar (na sprzedaż)</option>
              <option value="material">materiał (do zabiegów)</option>
              <option value="towar_material">towar i materiał</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="pr-price">Cena (zł)</label>
            <input id="pr-price" type="number" min={0} step={1} className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pr-ml">Pojemność (ml)</label>
            <input id="pr-ml" type="number" min={0} className="input" value={f.capacity_ml} onChange={(e) => setF({ ...f, capacity_ml: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pr-min">Ostrzegaj poniżej</label>
            <input id="pr-min" type="number" min={0} className="input" placeholder="op." value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pr-sku">Kod (SKU)</label>
            <input id="pr-sku" className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
          </div>
        </div>
        {!product && (
          <div>
            <label className="label" htmlFor="pr-stock">Stan początkowy (op.)</label>
            <input id="pr-stock" type="number" min={0} className="input w-32" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
          </div>
        )}
        {product && (
          <p className="text-sm text-muted">
            Stan: <strong>{qtyFmt(product.stock)} op.</strong> Zmienisz go przyciskiem „Przyjmij” albo „Korekta” na liście.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Aktywny (widoczny przy sprzedaży)
        </label>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Przyjęcie / korekta / zużycie ---------------- */

function StockDialog({
  product,
  initialMode,
  onClose,
  onSaved,
}: {
  product: Product;
  initialMode: "dostawa" | "korekta" | "zuzycie";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [value, setValue] = useState(mode === "korekta" ? String(product.stock) : "1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = Number(product.stock);
  const n = Number(value);
  const change = mode === "dostawa" ? n : mode === "zuzycie" ? -n : n - current;

  async function save() {
    if (Number.isNaN(n) || (mode !== "korekta" && n <= 0)) return setError("Wpisz prawidłową ilość.");
    if (change === 0) return onClose();
    setBusy(true);
    const { error } = await createClient()
      .from("stock_movements")
      .insert({ product_id: product.id, change, reason: mode, note: note.trim() || null });
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="mb-4 flex rounded-lg border border-border p-0.5 text-sm">
        {(
          [
            ["dostawa", "Przyjęcie dostawy"],
            ["zuzycie", "Zużycie do zabiegu"],
            ["korekta", "Korekta stanu"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setMode(k);
              setValue(k === "korekta" ? String(current) : "1");
            }}
            className={`flex-1 rounded-md px-2 py-1.5 ${mode === k ? "bg-accent text-white" : "text-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted">Obecny stan: <strong className="text-foreground">{qtyFmt(current)} op.</strong></p>
      <label className="label" htmlFor="st-val">{mode === "korekta" ? "Rzeczywisty stan (op.)" : "Ilość (op.)"}</label>
      <input id="st-val" type="number" min={0} step={mode === "korekta" ? 0.5 : 1} className="input w-32" value={value} onChange={(e) => setValue(e.target.value)} />
      <p className="mt-2 text-sm">
        Po zapisaniu: <strong>{qtyFmt(current + (Number.isNaN(change) ? 0 : change))} op.</strong>
      </p>
      <label className="label mt-4" htmlFor="st-note">Uwagi</label>
      <input
        id="st-note"
        className="input"
        placeholder={mode === "dostawa" ? "np. faktura nr…, dostawca" : mode === "korekta" ? "np. inwentaryzacja, uszkodzony" : "np. zabieg Bioline"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Sprzedaż produktów (poza wizytą) ---------------- */

function SaleDialog({
  products,
  staff,
  methods,
  initial,
  onClose,
  onSaved,
}: {
  products: Product[];
  staff: Staff[];
  methods: PaymentMethod[];
  initial?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<SaleLine[]>(
    initial ? [{ product_id: initial.id, name: initial.name, qty: 1, price: Number(initial.price), stock: Number(initial.stock) }] : [],
  );
  const [pay, setPay] = useState<PayLine[]>([{ method: "gotowka", amount: initial ? Number(initial.price) : 0 }]);
  const [client, setClient] = useState<ClientLite | null>(null);
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = linesTotal(items);
  const usable = methods.filter((m) => m.code !== "przedplata");

  async function save() {
    if (!items.some((i) => i.qty > 0)) return setError("Dodaj co najmniej jeden produkt.");
    if (!staffId) return setError("Wybierz, kto sprzedał (liczy się do statystyk pracownicy).");
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("sell_products", {
      p_items: items.filter((i) => i.qty > 0).map((i) => ({ product_id: i.product_id, qty: i.qty, price: i.price })),
      p_payments: pay,
      p_client_id: client?.id ?? null,
      p_staff_id: staffId,
      p_appointment_id: null,
      p_note: null,
    });
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      wide
      title="Sprzedaż produktów"
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : `Sprzedaj · ${money(total)}`}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <span className="label">Produkty</span>
          <ProductLines
            products={products}
            lines={items}
            onChange={(next) => {
              setItems(next);
              setPay((p) => rebalance(p, linesTotal(next)));
            }}
          />
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sale-staff">Sprzedała</label>
            <select id="sale-staff" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">— wybierz —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Klientka (opcjonalnie)</span>
            <ClientSearch value={client} onChange={setClient} />
          </div>
        </section>
        <section>
          <span className="label">Płatność</span>
          <PaymentLines methods={usable} lines={pay} onChange={setPay} total={total} />
        </section>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

function ClientSearch({ value, onChange }: { value: ClientLite | null; onChange: (c: ClientLite | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientLite[]>([]);

  useEffect(() => {
    const w = q.replace(/[,()%*]/g, " ").trim().split(/\s+/)[0];
    if (!w || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const { data } = await createClient()
        .from("clients")
        .select("id, first_name, last_name, phone, email")
        .or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,phone.ilike.%${w}%`)
        .limit(8);
      setResults((data ?? []) as ClientLite[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="flex-1">{clientName(value)}</span>
        <button className="btn-ghost px-2 py-0.5" onClick={() => onChange(null)}>zmień</button>
      </div>
    );
  return (
    <div className="relative">
      <input
        className="input"
        placeholder="nazwisko lub telefon"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (e.target.value.trim().length < 2) setResults([]);
        }}
        aria-label="Szukaj klientki"
      />
      {results.length > 0 && q.trim().length >= 2 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent-soft"
                onClick={() => {
                  onChange(c);
                  setQ("");
                  setResults([]);
                }}
              >
                {clientName(c)} <span className="text-muted">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
