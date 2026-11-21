"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import ProductLines, { linesTotal } from "./ProductLines";
import PaymentLines, { rebalance, type PayLine } from "./PaymentLines";
import type {
  ClientLite,
  Delivery,
  DeliveryDoc,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductKind,
  SaleLine,
  Staff,
  StockMovement,
} from "@/lib/types";
import { DOC_LABEL, KIND_LABEL, clientName, norm, qtyFmt } from "@/lib/types";
import { money, todayStr, toZoned } from "@/lib/time";

type Tab = "produkty" | "sprzedaz" | "zuzycie" | "dostawy";
const TABS: { key: Tab; label: string; title: string }[] = [
  { key: "produkty", label: "Produkty", title: "Produkty" },
  { key: "sprzedaz", label: "Sprzedaż", title: "Historia sprzedaży" },
  { key: "zuzycie", label: "Zużycie", title: "Historia zużycia" },
  { key: "dostawy", label: "Dostawy", title: "Historia dostaw" },
];
const PAGE = 100;

type Dialog =
  | { kind: "product"; product: Product | null }
  | { kind: "korekta"; product: Product }
  | { kind: "sale"; product?: Product }
  | { kind: "usage"; product?: Product }
  | { kind: "delivery"; product?: Product }
  | { kind: "deliveryDetails"; delivery: Delivery }
  | null;

const dmy = (date: string) => date.split("-").reverse().join(".");
const when = (iso: string) => {
  const z = toZoned(iso);
  return `${dmy(z.date)} ${z.time}`;
};
const lineLabel = (m: StockMovement) => {
  const q = Math.abs(Number(m.change));
  const ml = m.product?.capacity_ml ? ` (${qtyFmt(q * Number(m.product.capacity_ml))} ml)` : "";
  return `${m.product?.name ?? "—"} - ${qtyFmt(q)} op.${ml}`;
};

export default function WarehouseView({
  products,
  categories,
  sales,
  usage,
  deliveries,
  staff,
  methods,
  isOwner,
}: {
  products: Product[];
  categories: ProductCategory[];
  sales: StockMovement[];
  usage: StockMovement[];
  deliveries: Delivery[];
  staff: Staff[];
  methods: PaymentMethod[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("produkty");
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = () => {
    setDialog(null);
    router.refresh();
  };
  const title = TABS.find((t) => t.key === tab)!.title;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="font-serif text-3xl">
        <span className="text-muted">Magazyn /</span> {title}
      </h1>

      <div className="mt-4 mb-5 flex flex-wrap items-end gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold uppercase tracking-wide ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "produkty" && (
        <ProductsTab products={products} categories={categories} isOwner={isOwner} setDialog={setDialog} />
      )}
      {tab === "sprzedaz" && <SalesTab sales={sales} onNew={() => setDialog({ kind: "sale" })} />}
      {tab === "zuzycie" && <UsageTab usage={usage} onNew={() => setDialog({ kind: "usage" })} />}
      {tab === "dostawy" && (
        <DeliveriesTab
          deliveries={deliveries}
          onNew={() => setDialog({ kind: "delivery" })}
          onOpen={(d) => setDialog({ kind: "deliveryDetails", delivery: d })}
        />
      )}

      {dialog?.kind === "product" && (
        <ProductForm product={dialog.product} categories={categories} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "korekta" && <StockDialog product={dialog.product} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "sale" && (
        <SaleDialog products={products} staff={staff} methods={methods} initial={dialog.product} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "usage" && (
        <UsageDialog products={products} staff={staff} initial={dialog.product} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "delivery" && (
        <DeliveryDialog products={products} initial={dialog.product} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "deliveryDetails" && (
        <DeliveryDetails delivery={dialog.delivery} isOwner={isOwner} onClose={() => setDialog(null)} onDeleted={done} />
      )}
    </div>
  );
}

/* ================= Zakładki ================= */

function TabToolbar({ children, button }: { children: React.ReactNode; button?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {children}
      <div className="ml-auto">{button}</div>
    </div>
  );
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm text-muted">
      <span>
        Pozycje {total ? 1 : 0}–{Math.min(shown, total)} z {total}
      </span>
      {shown < total && (
        <button className="btn-secondary" onClick={onMore}>
          Pokaż więcej
        </button>
      )}
    </div>
  );
}

const TH = "px-3 py-2 font-medium";
const TABLE_HEAD = "bg-accent-soft text-left text-xs uppercase tracking-wide text-muted";

function ProductsTab({
  products,
  categories,
  isOwner,
  setDialog,
}: {
  products: Product[];
  categories: ProductCategory[];
  isOwner: boolean;
  setDialog: (d: Dialog) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
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

  return (
    <>
      <TabToolbar button={<button className="btn-primary" onClick={() => setDialog({ kind: "product", product: null })}>+ Dodaj produkt</button>}>
        <input className="input w-64" placeholder="szukaj produktu lub kodu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
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
      </TabToolbar>
      <p className="mb-2 text-sm text-muted">
        {visible.length} z {products.filter((p) => p.active).length} produktów
        {low > 0 && <span className="ml-2 text-amber-700 dark:text-amber-300">· {low} kończy się</span>}
        {isOwner && <span className="ml-2">· wartość stanu (wg cen sprzedaży) {money(stockValue)}</span>}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TH}>Nazwa</th>
              <th className={TH}>Kategoria</th>
              <th className={TH}>Rodzaj</th>
              <th className={`${TH} text-right`}>Stan</th>
              <th className={`${TH} text-right`}>Cena</th>
              <th className={TH}></th>
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
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
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
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "delivery", product: p })}>Dostawa</button>
                    {p.kind !== "material" && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "sale", product: p })}>Sprzedaj</button>
                    )}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "usage", product: p })}>Zużyj</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setDialog({ kind: "korekta", product: p })}>Korekta</button>
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
  );
}

function SalesTab({ sales, onNew }: { sales: StockMovement[]; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "wizyta" | "osobno">("");
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return sales
      .filter((m) => !kind || (kind === "wizyta" ? !!m.appointment_id : !m.appointment_id))
      .filter((m) => {
        const hay = norm([m.product?.name, m.staff?.full_name, m.client ? clientName(m.client) : ""].join(" "));
        return words.every((w) => hay.includes(w));
      });
  }, [sales, q, kind]);
  const sum = list.reduce((n, m) => n + Math.abs(Number(m.change)) * Number(m.unit_price ?? 0), 0);

  return (
    <>
      <TabToolbar button={<button className="btn-primary" onClick={onNew}>+ Nowa sprzedaż</button>}>
        <input className="input w-72" placeholder="wyszukaj w historii sprzedaży…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Rodzaj">
          <option value="">wszystkie</option>
          <option value="wizyta">przy wizycie</option>
          <option value="osobno">sprzedaż osobna</option>
        </select>
        <span className="text-sm text-muted">razem {money(sum)}</span>
      </TabToolbar>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TH}>Nazwa</th>
              <th className={TH}>Rodzaj</th>
              <th className={`${TH} text-right`}>Suma brutto</th>
              <th className={TH}>Sprzedano</th>
              <th className={TH}>Pracownik</th>
              <th className={TH}>Klient</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.slice(0, shown).map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2">{lineLabel(m)}</td>
                <td className="px-3 py-2 text-muted">{m.appointment_id ? "przy wizycie" : "sprzedaż"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(Math.abs(Number(m.change)) * Number(m.unit_price ?? 0))}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{when(m.created_at)}</td>
                <td className="px-3 py-2">{m.staff?.full_name}</td>
                <td className="px-3 py-2">{m.client ? clientName(m.client) : ""}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">Brak sprzedaży.</td>
              </tr>
            )}
          </tbody>
        </table>
        <MoreButton shown={shown} total={list.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>
    </>
  );
}

function UsageTab({ usage, onNew }: { usage: StockMovement[]; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return usage.filter((m) => {
      const hay = norm([m.product?.name, m.staff?.full_name, m.client ? clientName(m.client) : "", m.note].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [usage, q]);

  return (
    <>
      <TabToolbar button={<button className="btn-primary" onClick={onNew}>+ Dodaj zużycie</button>}>
        <input className="input w-72" placeholder="wyszukaj w historii zużycia…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
      </TabToolbar>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TH}>Nazwa produktu</th>
              <th className={TH}>Wprowadzono</th>
              <th className={TH}>Pracownik</th>
              <th className={TH}>Klient</th>
              <th className={TH}>Uwagi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.slice(0, shown).map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2">{lineLabel(m)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{when(m.created_at)}</td>
                <td className="px-3 py-2">{m.staff?.full_name}</td>
                <td className="px-3 py-2">{m.client ? clientName(m.client) : ""}</td>
                <td className="px-3 py-2 text-muted">{m.note}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">Brak zużycia.</td>
              </tr>
            )}
          </tbody>
        </table>
        <MoreButton shown={shown} total={list.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>
    </>
  );
}

const deliveryValue = (d: Delivery) =>
  d.stock_movements.reduce((n, m) => n + Number(m.change) * Number(m.unit_cost ?? 0), 0);

function DeliveriesTab({
  deliveries,
  onNew,
  onOpen,
}: {
  deliveries: Delivery[];
  onNew: () => void;
  onOpen: (d: Delivery) => void;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | DeliveryDoc>("");
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return deliveries
      .filter((d) => !type || d.document_type === type)
      .filter((d) => {
        const hay = norm([d.document_number, d.supplier, d.note, ...d.stock_movements.map((m) => m.product?.name)].join(" "));
        return words.every((w) => hay.includes(w));
      });
  }, [deliveries, q, type]);

  return (
    <>
      <TabToolbar button={<button className="btn-primary" onClick={onNew}>+ Nowa dostawa</button>}>
        <input className="input w-72" placeholder="wyszukaj w historii dostaw…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Rodzaj dokumentu">
          <option value="">wszystkie</option>
          {(Object.keys(DOC_LABEL) as DeliveryDoc[]).map((k) => (
            <option key={k} value={k}>{DOC_LABEL[k]}</option>
          ))}
        </select>
      </TabToolbar>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TH}>Wystawiono</th>
              <th className={`${TH} text-right`}>Liczba pozycji</th>
              <th className={TH}>Numer faktury</th>
              <th className={`${TH} text-right`}>Wartość</th>
              <th className={TH}>Dostawca</th>
              <th className={TH}>Rodzaj</th>
              <th className={TH}>Wprowadzono</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.slice(0, shown).map((d) => (
              <tr key={d.id} className="cursor-pointer hover:bg-accent-soft" onClick={() => onOpen(d)}>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dmy(d.issued_on)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.stock_movements.length}</td>
                <td className="px-3 py-2 text-accent">{d.document_number || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(deliveryValue(d))}</td>
                <td className="px-3 py-2">{d.supplier}</td>
                <td className="px-3 py-2 text-muted">{DOC_LABEL[d.document_type]}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{when(d.created_at)}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">Brak dostaw.</td>
              </tr>
            )}
          </tbody>
        </table>
        <MoreButton shown={shown} total={list.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>
    </>
  );
}

/* ================= Okna: dostawa, zużycie ================= */

function DeliveryDialog({
  products,
  initial,
  onClose,
  onSaved,
}: {
  products: Product[];
  initial?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doc, setDoc] = useState<DeliveryDoc>("faktura");
  const [number, setNumber] = useState("");
  const [issued, setIssued] = useState(todayStr());
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<SaleLine[]>(
    initial ? [{ product_id: initial.id, name: initial.name, qty: 1, price: 0, stock: Number(initial.stock) }] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!items.some((i) => i.qty > 0)) return setError("Dodaj co najmniej jeden produkt.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("create_delivery", {
      p: {
        document_type: doc,
        document_number: number,
        issued_on: issued,
        supplier,
        note,
        items: items.filter((i) => i.qty > 0).map((i) => ({ product_id: i.product_id, qty: i.qty, unit_cost: i.price || null })),
      },
    });
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      wide
      title="Nowa dostawa"
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Przyjmij na stan"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
          <span className="ml-auto text-sm text-muted">wartość zakupu {money(linesTotal(items))}</span>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="dl-type">Rodzaj</label>
          <select id="dl-type" className="input" value={doc} onChange={(e) => setDoc(e.target.value as DeliveryDoc)}>
            {(Object.keys(DOC_LABEL) as DeliveryDoc[]).map((k) => (
              <option key={k} value={k}>{DOC_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dl-no">Numer dokumentu</label>
          <input id="dl-no" className="input" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="FV 12/11/2026" />
        </div>
        <div>
          <label className="label" htmlFor="dl-date">Wystawiono</label>
          <input id="dl-date" type="date" className="input" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dl-sup">Dostawca</label>
          <input id="dl-sup" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="np. Epicuren" />
        </div>
      </div>
      <span className="label mt-5">Pozycje (ilość w op. i cena zakupu za op.)</span>
      <ProductLines products={products} lines={items} onChange={setItems} mode="delivery" />
      <label className="label mt-4" htmlFor="dl-note">Uwagi</label>
      <input id="dl-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox error={error} />
    </Modal>
  );
}

function DeliveryDetails({
  delivery,
  isOwner,
  onClose,
  onDeleted,
}: {
  delivery: Delivery;
  isOwner: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    const { error } = await createClient().from("deliveries").delete().eq("id", delivery.id);
    if (error) return setError(errText(error));
    onDeleted();
  }
  return (
    <Modal
      title={`${DOC_LABEL[delivery.document_type]} ${delivery.document_number ?? ""}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Zamknij</button>
          {isOwner &&
            (confirm ? (
              <button className="btn-ghost ml-auto text-red-600" onClick={remove}>Na pewno usunąć? Stan się cofnie</button>
            ) : (
              <button className="btn-ghost ml-auto text-sm" onClick={() => setConfirm(true)}>Usuń dostawę</button>
            ))}
        </>
      }
    >
      <p className="text-sm text-muted">
        wystawiono {dmy(delivery.issued_on)} · {delivery.supplier || "dostawca nieznany"} · wprowadzono {when(delivery.created_at)}
      </p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-sm">
        {delivery.stock_movements.map((m, i) => (
          <li key={i} className="flex justify-between gap-3 px-3 py-2">
            <span>{m.product?.name}</span>
            <span className="whitespace-nowrap tabular-nums text-muted">
              {qtyFmt(m.change)} op. × {m.unit_cost !== null ? money(m.unit_cost) : "—"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right font-medium">Wartość {money(deliveryValue(delivery))}</p>
      {delivery.note && <p className="mt-2 text-sm text-muted">{delivery.note}</p>}
      <ErrorBox error={error} />
    </Modal>
  );
}

function UsageDialog({
  products,
  staff,
  initial,
  onClose,
  onSaved,
}: {
  products: Product[];
  staff: Staff[];
  initial?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<SaleLine[]>(
    initial ? [{ product_id: initial.id, name: initial.name, qty: 1, price: 0, stock: Number(initial.stock) }] : [],
  );
  const [staffId, setStaffId] = useState("");
  const [client, setClient] = useState<ClientLite | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const rows = items.filter((i) => i.qty > 0);
    if (!rows.length) return setError("Dodaj co najmniej jeden produkt.");
    setBusy(true);
    setError(null);
    const { error } = await createClient()
      .from("stock_movements")
      .insert(
        rows.map((i) => ({
          product_id: i.product_id,
          change: -i.qty,
          reason: "zuzycie",
          staff_id: staffId || null,
          client_id: client?.id ?? null,
          note: note.trim() || null,
        })),
      );
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      wide
      title="Zużycie produktów"
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz zużycie"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <span className="label">Produkty (ilość w op., np. 0,5)</span>
      <ProductLines products={products} lines={items} onChange={setItems} mode="usage" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="us-staff">Pracownik</label>
          <select id="us-staff" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">— nie dotyczy —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Klientka (opcjonalnie)</span>
          <ClientSearch value={client} onChange={setClient} />
        </div>
      </div>
      <label className="label mt-4" htmlFor="us-note">Uwagi</label>
      <input id="us-note" className="input" placeholder="np. zabieg Bioline, otwarte opakowanie testowe" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox error={error} />
    </Modal>
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
          .insert({ product_id: data.id, change: Number(initialStock), reason: "korekta", note: "stan początkowy" });
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
            Stan: <strong>{qtyFmt(product.stock)} op.</strong> Zmienisz go przyciskami „Dostawa”, „Zużyj” albo „Korekta” na liście.
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

/* ---------------- Korekta stanu ---------------- */

function StockDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const current = Number(product.stock);
  const [value, setValue] = useState(String(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(value);
  const change = n - current;

  async function save() {
    if (Number.isNaN(n) || n < 0) return setError("Wpisz prawidłowy stan.");
    if (change === 0) return onClose();
    setBusy(true);
    const { error } = await createClient()
      .from("stock_movements")
      .insert({ product_id: product.id, change, reason: "korekta", note: note.trim() || null });
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      title={`Korekta stanu – ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Stan w systemie: <strong className="text-foreground">{qtyFmt(current)} op.</strong></p>
      <label className="label" htmlFor="st-val">Rzeczywisty stan (op.)</label>
      <input id="st-val" type="number" min={0} step={0.5} className="input w-32" value={value} onChange={(e) => setValue(e.target.value)} />
      {!Number.isNaN(change) && change !== 0 && (
        <p className="mt-2 text-sm">Zmiana: <strong>{change > 0 ? "+" : ""}{qtyFmt(change)} op.</strong></p>
      )}
      <label className="label mt-4" htmlFor="st-note">Powód</label>
      <input id="st-note" className="input" placeholder="np. inwentaryzacja, uszkodzone opakowanie" value={note} onChange={(e) => setNote(e.target.value)} />
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
