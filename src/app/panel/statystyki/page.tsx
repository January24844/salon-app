import Link from "next/link";
import CashEntryForm from "@/components/CashEntryForm";
import { requireTeam } from "@/lib/auth";
import { addDays, formatDayShort, formatMinutes, isValidDate, money, todayStr, weekday, zonedToUtc } from "@/lib/time";

type StaffRow = {
  id: string;
  full_name: string;
  color: string;
  visits: number;
  minutes: number;
  services_gross: number;
  services_net: number;
  products_gross: number;
  products_net: number;
  packages_gross: number;
  packages_net: number;
  vouchers_gross: number;
  vouchers_net: number;
  revenue_gross: number;
};
type Report = {
  visits: number;
  visit_minutes: number;
  services_gross: number;
  services_net: number;
  products_gross: number;
  products_net: number;
  packages_gross: number;
  packages_net: number;
  revenue_gross: number;
  vouchers_gross: number;
  deposits_gross: number;
  cash_in: number;
  cash_out: number;
  non_revenue_total: number;
  non_revenue_services: number;
  non_revenue_products: number;
  methods: { name: string; amount: number }[];
  staff: StaffRow[];
};

const PERIODS = [
  { key: "dzien", label: "Dzień" },
  { key: "tydzien", label: "Tydzień" },
  { key: "miesiac", label: "Miesiąc" },
  { key: "zakres", label: "Zakres" },
] as const;

function range(p: string, d: string, od?: string, doo?: string): [string, string] {
  if (p === "tydzien") {
    const mon = addDays(d, 1 - weekday(d));
    return [mon, addDays(mon, 7)];
  }
  if (p === "miesiac") {
    const first = d.slice(0, 8) + "01";
    const [y, m] = d.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return [first, next];
  }
  if (p === "zakres" && isValidDate(od) && isValidDate(doo)) return [od, addDays(doo, 1)];
  return [d, addDays(d, 1)];
}

function shift(p: string, d: string, dir: number) {
  if (p === "tydzien") return addDays(d, 7 * dir);
  if (p === "miesiac") {
    const [y, m] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return addDays(d, dir);
}

export default async function StatsPage({ searchParams }: PageProps<"/panel/statystyki">) {
  const sp = await searchParams;
  const { supabase, role } = await requireTeam();
  if (role !== "owner") {
    return <p className="m-8 text-center text-muted">Statystyki są dostępne tylko dla właścicielki.</p>;
  }

  const p = PERIODS.some((x) => x.key === sp.p) ? (sp.p as string) : "dzien";
  const d = isValidDate(sp.d as string) ? (sp.d as string) : todayStr();
  const od = sp.od as string | undefined;
  const doo = sp.do as string | undefined;
  const [from, to] = range(p, d, od, doo);

  const { data, error } = await supabase.rpc("stats_report", {
    p_from: zonedToUtc(from).toISOString(),
    p_to: zonedToUtc(to).toISOString(),
  });
  if (error) return <p className="m-8 rounded-lg bg-red-50 p-4 text-sm text-red-800">Błąd: {error.message}</p>;
  const r = data as Report;
  const n = (x: number) => Number(x ?? 0);
  const staffTotal = r.staff.reduce((s, x) => s + n(x.revenue_gross), 0);
  const methodsTotal = r.methods.reduce((s, x) => s + n(x.amount), 0);
  const label = to === addDays(from, 1) ? formatDayShort(from) : `${formatDayShort(from)} – ${formatDayShort(addDays(to, -1))}`;
  const href = (o: Record<string, string>) => `/panel/statystyki?${new URLSearchParams({ p, d, ...o })}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-4 font-serif text-3xl">Statystyki</h1>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {PERIODS.map((x) => (
            <Link
              key={x.key}
              href={href({ p: x.key })}
              className={`rounded-md px-3 py-1.5 text-sm ${p === x.key ? "bg-accent text-white" : "text-muted hover:text-foreground"}`}
            >
              {x.label}
            </Link>
          ))}
        </div>
        {p !== "zakres" ? (
          <div className="flex items-center gap-1">
            <Link className="btn-secondary px-3" href={href({ d: shift(p, d, -1) })} aria-label="Wcześniej">‹</Link>
            <span className="px-2 text-sm font-medium">{label}</span>
            <Link className="btn-secondary px-3" href={href({ d: shift(p, d, 1) })} aria-label="Później">›</Link>
          </div>
        ) : (
          <form className="flex flex-wrap items-center gap-2" action="/panel/statystyki">
            <input type="hidden" name="p" value="zakres" />
            <input type="date" name="od" defaultValue={od ?? from} className="input w-40" aria-label="Od" />
            –
            <input type="date" name="do" defaultValue={doo ?? addDays(to, -1)} className="input w-40" aria-label="Do" />
            <button className="btn-secondary">Pokaż</button>
          </form>
        )}
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-serif text-2xl">Salon ogółem</h2>
          <p className="mt-2 text-sm">
            Liczba sfinalizowanych wizyt: <strong>{r.visits}</strong>
            <br />
            Łączny czas trwania sfinalizowanych wizyt: <strong>{formatMinutes(n(r.visit_minutes))}</strong>
          </p>

          <table className="mt-4 w-full overflow-hidden rounded-xl border border-border bg-card text-sm">
            <thead className="bg-accent-soft text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 text-right font-medium">netto</th>
                <th className="px-3 py-2 text-right font-medium">brutto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {[
                ["Sprzedaż usług", r.services_net, r.services_gross],
                ["Sprzedaż towarów", r.products_net, r.products_gross],
                ["Sprzedaż karnetów", r.packages_net, r.packages_gross],
              ].map(([l, net, gross]) => (
                <tr key={l as string}>
                  <th className="px-3 py-2 text-left font-medium">{l}</th>
                  <td className="px-3 py-2 text-right">{money(net)}</td>
                  <td className="px-3 py-2 text-right">{money(gross)}</td>
                </tr>
              ))}
              <tr className="bg-accent-soft/50">
                <th className="px-3 py-2 text-left font-medium" colSpan={2}>Utarg ze sprzedaży usług i towarów brutto</th>
                <td className="px-3 py-2 text-right text-base font-semibold">{money(r.revenue_gross)}</td>
              </tr>
              <tr>
                <th className="px-3 py-2 text-left font-medium" colSpan={2}>Sprzedaż bonów</th>
                <td className="px-3 py-2 text-right">{money(r.vouchers_gross)}</td>
              </tr>
              <tr>
                <th className="px-3 py-2 text-left font-medium" colSpan={2}>Przedpłaty</th>
                <td className="px-3 py-2 text-right">{money(r.deposits_gross)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <p>Saldo gotówki w kasie: <strong>{money(n(r.cash_in) - n(r.cash_out))}</strong></p>
              <p className="text-muted">Wpływy: {money(r.cash_in)}</p>
              <p className="text-muted">Wydatki: {money(r.cash_out)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <p>Metody niewliczone do utargu: <strong>{money(r.non_revenue_total)}</strong></p>
              <p className="text-muted">Sprzedaż usług: {money(r.non_revenue_services)}</p>
              <p className="text-muted">Sprzedaż towarów: {money(r.non_revenue_products)}</p>
            </div>
          </div>
          <CashEntryForm />
        </div>

        <div>
          <h2 className="font-serif text-2xl">Udział metod płatności w utargu</h2>
          <ShareBars rows={r.methods.map((m) => ({ label: m.name, value: n(m.amount) }))} total={methodsTotal} empty="Brak płatności w tym okresie." />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl">Dane w podziale na pracowników</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] text-sm tabular-nums">
            <thead className="bg-accent-soft text-xs text-muted">
              <tr className="text-right">
                <th className="px-3 py-2 text-left font-medium">Pracownik</th>
                <th className="px-3 py-2 font-medium">Wizyty</th>
                <th className="px-3 py-2 font-medium">Łączny czas</th>
                <th className="px-3 py-2 font-medium">Usługi brutto</th>
                <th className="px-3 py-2 font-medium">Usługi netto</th>
                <th className="px-3 py-2 font-medium">Towary brutto</th>
                <th className="px-3 py-2 font-medium">Karnety brutto</th>
                <th className="px-3 py-2 font-medium">Bony brutto</th>
                <th className="px-3 py-2 font-medium">Utarg brutto</th>
                <th className="px-3 py-2 font-medium">Procent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-right">
              {r.staff.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-left">
                    <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: s.color }} />
                    {s.full_name}
                  </td>
                  <td className="px-3 py-2">{s.visits}</td>
                  <td className="px-3 py-2">{formatMinutes(n(s.minutes))}</td>
                  <td className="px-3 py-2">{money(s.services_gross)}</td>
                  <td className="px-3 py-2">{money(s.services_net)}</td>
                  <td className="px-3 py-2">{money(s.products_gross)}</td>
                  <td className="px-3 py-2">{money(s.packages_gross)}</td>
                  <td className="px-3 py-2">{money(s.vouchers_gross)}</td>
                  <td className="px-3 py-2 font-medium">{money(s.revenue_gross)}</td>
                  <td className="px-3 py-2">{staffTotal ? ((n(s.revenue_gross) / staffTotal) * 100).toFixed(1).replace(".", ",") : "0"}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border font-semibold">
              <tr className="text-right">
                <td className="px-3 py-2 text-left">Łącznie</td>
                <td className="px-3 py-2">{r.staff.reduce((a, s) => a + s.visits, 0)}</td>
                <td className="px-3 py-2">{formatMinutes(r.staff.reduce((a, s) => a + n(s.minutes), 0))}</td>
                <td className="px-3 py-2">{money(r.staff.reduce((a, s) => a + n(s.services_gross), 0))}</td>
                <td className="px-3 py-2">{money(r.staff.reduce((a, s) => a + n(s.services_net), 0))}</td>
                <td className="px-3 py-2">{money(r.staff.reduce((a, s) => a + n(s.products_gross), 0))}</td>
                <td className="px-3 py-2">{money(r.staff.reduce((a, s) => a + n(s.packages_gross), 0))}</td>
                <td className="px-3 py-2">{money(r.staff.reduce((a, s) => a + n(s.vouchers_gross), 0))}</td>
                <td className="px-3 py-2">{money(staffTotal)}</td>
                <td className="px-3 py-2">{staffTotal ? "100%" : "0%"}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h3 className="mt-8 font-serif text-xl">Udział pracowników w utargu</h3>
        <ShareBars
          rows={r.staff.filter((s) => n(s.revenue_gross) > 0).map((s) => ({ label: s.full_name, value: n(s.revenue_gross) }))}
          total={staffTotal}
          empty="Brak utargu w tym okresie."
        />
      </section>
    </div>
  );
}

/** Udziały jako poziome paski z etykietą, kwotą i procentem (czytelniejsze niż wykres kołowy). */
function ShareBars({ rows, total, empty }: { rows: { label: string; value: number }[]; total: number; empty: string }) {
  if (!rows.length || !total) return <p className="mt-4 text-sm text-muted">{empty}</p>;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <ul className="mt-4 space-y-3">
      {sorted.map((row) => {
        const pct = (row.value / total) * 100;
        return (
          <li key={row.label} title={`${row.label}: ${money(row.value)} (${pct.toFixed(1)}%)`}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span>{row.label}</span>
              <span className="tabular-nums text-muted">
                {money(row.value)} <span className="ml-1 font-medium text-foreground">{pct.toFixed(1).replace(".", ",")}%</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-accent-soft">
              <div className="h-2.5 rounded-full bg-accent" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
