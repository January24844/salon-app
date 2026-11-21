"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import ScheduleCell, { hoursFmt } from "./Cell";
import DayDialog from "./DayDialog";
import { DAY_NAMES, dmy } from "./WeekView";
import { resolveDay } from "@/components/calendar/schedule";
import type { ScheduleDay, ScheduleTemplate, Staff, WorkingHours } from "@/lib/types";
import { addDays, isoWeek, todayStr, weekday } from "@/lib/time";

const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const SHORT = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"];

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const endOfMonth = (m: string) => addDays(`${shiftMonth(m, 1)}-01`, -1);

/** Krótki opis szablonu, np. "tydz. 1: pon 17:00–21:00, czw 17:00–21:00" */
export function templateSummary(t: ScheduleTemplate) {
  return Array.from({ length: t.weeks }, (_, w) => {
    const days = t.schedule_template_days
      .filter((d) => d.week_no === w + 1)
      .sort((a, b) => a.weekday - b.weekday)
      .map((d) => `${SHORT[d.weekday - 1]} ${d.start_time.slice(0, 5)}–${d.end_time.slice(0, 5)}`);
    return `${t.weeks > 1 ? `tydz. ${w + 1}: ` : ""}${days.join(", ") || "wolne"}`;
  });
}

export default function StaffMonthView({
  staff,
  month,
  hours,
  schedule,
  closedWeekdays,
  templates,
}: {
  staff: Staff;
  month: string; // YYYY-MM
  hours: WorkingHours[];
  schedule: ScheduleDay[];
  closedWeekdays: number[];
  templates: ScheduleTemplate[];
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [tplEdit, setTplEdit] = useState<ScheduleTemplate | "new" | null>(null);
  const [apply, setApply] = useState<ScheduleTemplate | null>(null);
  const [clear, setClear] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const today = todayStr();
  const first = `${month}-01`;
  const last = endOfMonth(month);
  const firstMonday = addDays(first, 1 - weekday(first));
  const weeks: string[] = [];
  for (let m = firstMonday; m <= last; m = addDays(m, 7)) weeks.push(m);
  const [y, mo] = month.split("-").map(Number);

  const refresh = () => router.refresh();
  const resolve = (d: string) => resolveDay(staff.id, d, hours, schedule, closedWeekdays);
  const monthMinutes = weeks
    .flatMap((w) => Array.from({ length: 7 }, (_, i) => addDays(w, i)))
    .filter((d) => d >= first && d <= last)
    .reduce((n, d) => n + resolve(d).minutes, 0);

  // tygodnie z bieżącego widoku – do kopiowania do szablonu
  const sourceWeeks = weeks.map((w) => ({
    label: `${isoWeek(w)} tydzień (${dmy(w)})`,
    days: Array.from({ length: 7 }, (_, i) => {
      const r = resolve(addDays(w, i));
      return r.kind === "work" && r.intervals.length
        ? { weekday: i + 1, start: toTime(r.intervals[0][0]), end: toTime(r.intervals[0][1]) }
        : null;
    }).filter(Boolean) as { weekday: number; start: string; end: string }[],
  }));

  return (
    <div className="min-w-0 flex-1 px-4 py-6">
      <h1 className="font-serif text-3xl">
        <span className="text-muted">Grafiki pracowników /</span> {staff.full_name}
      </h1>

      <div className="my-5 flex flex-wrap items-center gap-2">
        <div className="flex">
          <Link href={`/panel/grafik/${staff.id}?m=${shiftMonth(month, -1)}`} className="btn-secondary rounded-r-none px-3" aria-label="Poprzedni miesiąc">‹</Link>
          <Link href={`/panel/grafik/${staff.id}?m=${shiftMonth(month, 1)}`} className="btn-secondary -ml-px rounded-l-none px-3" aria-label="Następny miesiąc">›</Link>
        </div>
        <span className="px-2 text-lg font-medium first-letter:uppercase">{MONTHS[mo - 1]} {y}</span>
        <Link href={`/panel/grafik/${staff.id}?m=${today.slice(0, 7)}`} className="btn-secondary">Dzisiaj</Link>
        <span className="text-sm text-muted">w tym miesiącu: <strong className="text-foreground">{hoursFmt(monthMinutes)}</strong></span>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost text-sm" onClick={() => setClear(true)}>Wyczyść okres</button>
          <Link href="/panel/grafik" className="btn-secondary text-sm">Wszyscy pracownicy</Link>
        </div>
      </div>

      {msg && <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">{msg}</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] table-fixed text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-28 px-3 py-2"></th>
                {DAY_NAMES.map((d) => (
                  <th key={d} className="px-1.5 py-2 text-center font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeks.map((w) => {
                const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
                const res = days.map(resolve);
                const isCurrent = days.includes(today);
                return (
                  <tr key={w} className={isCurrent ? "bg-accent-soft/40" : ""}>
                    <td className="px-3 py-2 align-top">
                      <Link href={`/panel/grafik?w=${w}`} className="text-accent hover:underline">{isoWeek(w)} tydzień</Link>
                      <span className="block font-semibold">{hoursFmt(res.reduce((n, r) => n + r.minutes, 0))}</span>
                    </td>
                    {days.map((d, i) => (
                      <td key={d} className={`p-1.5 align-top ${d < first || d > last ? "opacity-45" : ""}`}>
                        <span className={`mb-1 block text-xs tabular-nums ${d === today ? "font-semibold text-accent" : "text-muted"}`}>{dmy(d)}</span>
                        <ScheduleCell day={res[i]} color={staff.color} highlight={d === today} onClick={() => setEdit(d)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ---------- szablony ---------- */}
        <section className="h-fit rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">Szablony grafiku</h2>
            <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setTplEdit("new")}>+ Nowy</button>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">
              Zapisz stały układ pracy (np. pon i czw 17–21, co drugi tydzień pt zamiast czw), a potem jednym kliknięciem wstaw go
              na kolejne tygodnie lub miesiące.
            </p>
          ) : (
            <ul className="space-y-3">
              {templates.map((t) => (
                <li key={t.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">
                    {t.name}
                    <span className="ml-2 text-xs font-normal text-muted">{t.weeks === 1 ? "co tydzień" : `rotacja ${t.weeks} tyg.`}</span>
                  </p>
                  {templateSummary(t).map((line, i) => (
                    <p key={i} className="text-xs text-muted">{line}</p>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <button className="btn-primary px-3 py-1 text-sm" onClick={() => setApply(t)}>Wstaw z szablonu</button>
                    <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setTplEdit(t)}>Edytuj</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {edit && (() => {
        const r = resolve(edit);
        const weekly = resolveDay(staff.id, edit, hours, [], closedWeekdays);
        return (
          <DayDialog
            staffId={staff.id}
            staffName={staff.full_name}
            date={edit}
            current={r.override}
            defaultLabel={weekly.kind === "none" ? "brak grafiku" : weekly.label}
            onClose={() => setEdit(null)}
            onSaved={() => {
              setEdit(null);
              refresh();
            }}
          />
        );
      })()}
      {tplEdit && (
        <TemplateEditor
          staffId={staff.id}
          template={tplEdit === "new" ? null : tplEdit}
          sourceWeeks={sourceWeeks}
          onClose={() => setTplEdit(null)}
          onSaved={() => {
            setTplEdit(null);
            refresh();
          }}
        />
      )}
      {apply && (
        <ApplyDialog
          template={apply}
          defaultFrom={first > today ? first : addDays(today, 1 - weekday(today) + 7)}
          onClose={() => setApply(null)}
          onDone={(n, from) => {
            setApply(null);
            setMsg(`Wstawiono grafik z szablonu „${apply.name}”: ${n} dni.`);
            router.push(`/panel/grafik/${staff.id}?m=${from.slice(0, 7)}`);
            refresh();
          }}
        />
      )}
      {clear && (
        <ClearDialog
          staffId={staff.id}
          defaultFrom={first}
          defaultTo={last}
          onClose={() => setClear(false)}
          onDone={(n) => {
            setClear(false);
            setMsg(`Usunięto ${n} wpisów z grafiku.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

const toTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/* ---------------- Edytor szablonu ---------------- */

type Cell = { on: boolean; start: string; end: string };

function TemplateEditor({
  staffId,
  template,
  sourceWeeks,
  onClose,
  onSaved,
}: {
  staffId: string;
  template: ScheduleTemplate | null;
  sourceWeeks: { label: string; days: { weekday: number; start: string; end: string }[] }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const empty = (): Cell[] => Array.from({ length: 7 }, () => ({ on: false, start: "09:00", end: "17:00" }));
  const [name, setName] = useState(template?.name ?? "");
  const [weeks, setWeeks] = useState<Cell[][]>(() => {
    const n = template?.weeks ?? 1;
    return Array.from({ length: n }, (_, w) => {
      const row = empty();
      for (const d of template?.schedule_template_days ?? [])
        if (d.week_no === w + 1) row[d.weekday - 1] = { on: true, start: d.start_time.slice(0, 5), end: d.end_time.slice(0, 5) };
      return row;
    });
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const setCell = (w: number, d: number, c: Partial<Cell>) =>
    setWeeks((ws) => ws.map((row, i) => (i === w ? row.map((x, j) => (j === d ? { ...x, ...c } : x)) : row)));
  const setCount = (n: number) =>
    setWeeks((ws) => (n > ws.length ? [...ws, ...Array.from({ length: n - ws.length }, () => ws[ws.length - 1].map((c) => ({ ...c })))] : ws.slice(0, n)));
  const fillFrom = (w: number, srcIdx: number) => {
    const src = sourceWeeks[srcIdx];
    if (!src) return;
    setWeeks((ws) =>
      ws.map((row, i) =>
        i === w
          ? row.map((_, d) => {
              const s = src.days.find((x) => x.weekday === d + 1);
              return s ? { on: true, start: s.start, end: s.end } : { on: false, start: "09:00", end: "17:00" };
            })
          : row,
      ),
    );
  };

  async function save() {
    if (!name.trim()) return setError("Nadaj szablonowi nazwę, np. „Standard” albo „Rotacja pon-czw / pon-pt”.");
    for (const row of weeks) for (const c of row) if (c.on && c.end <= c.start) return setError("Godzina końca musi być późniejsza niż początku.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let id = template?.id;
    if (id) {
      const { error } = await supabase.from("schedule_templates").update({ name: name.trim(), weeks: weeks.length }).eq("id", id);
      if (error) return fail(error);
      const del = await supabase.from("schedule_template_days").delete().eq("template_id", id);
      if (del.error) return fail(del.error);
    } else {
      const { data, error } = await supabase
        .from("schedule_templates")
        .insert({ staff_id: staffId, name: name.trim(), weeks: weeks.length })
        .select("id")
        .single();
      if (error) return fail(error);
      id = data.id as string;
    }
    const rows = weeks.flatMap((row, w) =>
      row.flatMap((c, d) => (c.on ? [{ template_id: id, week_no: w + 1, weekday: d + 1, start_time: c.start, end_time: c.end }] : [])),
    );
    if (rows.length) {
      const ins = await supabase.from("schedule_template_days").insert(rows);
      if (ins.error) return fail(ins.error);
    }
    onSaved();
  }
  async function remove() {
    if (!template) return;
    const { error } = await createClient().from("schedule_templates").delete().eq("id", template.id);
    if (error) return setError(errText(error));
    onSaved();
  }
  function fail(e: unknown) {
    setBusy(false);
    setError(errText(e));
  }

  return (
    <Modal
      wide
      title={template ? "Edycja szablonu" : "Nowy szablon grafiku"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz szablon"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
          {template &&
            (confirmDel ? (
              <button className="btn-ghost ml-auto text-red-600" onClick={remove}>Na pewno usunąć szablon?</button>
            ) : (
              <button className="btn-ghost ml-auto text-sm" onClick={() => setConfirmDel(true)}>Usuń szablon</button>
            ))}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label className="label" htmlFor="tp-name">Nazwa</label>
          <input id="tp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Standard, Rotacja 2-tyg." />
        </div>
        <div>
          <label className="label" htmlFor="tp-weeks">Powtarza się co</label>
          <select id="tp-weeks" className="input" value={weeks.length} onChange={(e) => setCount(Number(e.target.value))}>
            <option value={1}>1 tydzień</option>
            <option value={2}>2 tygodnie (rotacja)</option>
            <option value={3}>3 tygodnie</option>
            <option value={4}>4 tygodnie</option>
          </select>
        </div>
      </div>

      {weeks.map((row, w) => (
        <div key={w} className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="label mb-0">{weeks.length > 1 ? `Tydzień ${w + 1}` : "Tydzień"}</span>
            {sourceWeeks.length > 0 && (
              <select
                className="input w-auto py-1 text-xs"
                value=""
                onChange={(e) => e.target.value !== "" && fillFrom(w, Number(e.target.value))}
                aria-label="Skopiuj z tygodnia"
              >
                <option value="">skopiuj z grafiku…</option>
                {sourceWeeks.map((s, i) => (
                  <option key={i} value={i}>{s.label}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7">
            {row.map((c, d) => (
              <div key={d} className={`rounded-lg border p-2 ${c.on ? "border-accent bg-accent-soft/50" : "border-border"}`}>
                <label className="flex items-center gap-1.5 text-xs font-medium">
                  <input type="checkbox" checked={c.on} onChange={(e) => setCell(w, d, { on: e.target.checked })} />
                  {SHORT[d]}
                </label>
                {c.on ? (
                  <div className="mt-1 space-y-1">
                    <input type="time" step={900} className="input px-1.5 py-1 text-xs" value={c.start} onChange={(e) => setCell(w, d, { start: e.target.value })} aria-label={`${SHORT[d]} od`} />
                    <input type="time" step={900} className="input px-1.5 py-1 text-xs" value={c.end} onChange={(e) => setCell(w, d, { end: e.target.value })} aria-label={`${SHORT[d]} do`} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">wolne</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Wstaw z szablonu ---------------- */

function ApplyDialog({
  template,
  defaultFrom,
  onClose,
  onDone,
}: {
  template: ScheduleTemplate;
  defaultFrom: string;
  onClose: () => void;
  onDone: (n: number, from: string) => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(addDays(defaultFrom, 7 * 8 - 1));
  const [startWeek, setStartWeek] = useState(1);
  const [overwrite, setOverwrite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!from || !to || to < from) return setError("Sprawdź daty.");
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("apply_schedule_template", {
      p_template_id: template.id,
      p_from: from,
      p_to: to,
      p_start_week: startWeek,
      p_overwrite: overwrite,
    });
    setBusy(false);
    if (error) return setError(errText(error));
    onDone(Number(data ?? 0), from);
  }

  const quick = (weeksN: number) => setTo(addDays(from, 7 * weeksN - 1 - (weekday(from) - 1)));

  return (
    <Modal
      title={`Wstaw z szablonu: ${template.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={run} disabled={busy}>{busy ? "Wstawiam…" : "Wstaw grafik"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="space-y-1 text-xs text-muted">
        {templateSummary(template).map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ap-from">Od</label>
          <input id="ap-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ap-to">Do</label>
          <input id="ap-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {(
          [
            [4, "4 tygodnie"],
            [8, "8 tygodni"],
            [13, "3 miesiące"],
            [26, "pół roku"],
          ] as const
        ).map(([n, label]) => (
          <button key={n} className="rounded-full border border-border px-2.5 py-1 hover:bg-accent-soft" onClick={() => quick(n)}>
            {label}
          </button>
        ))}
      </div>
      {template.weeks > 1 && (
        <div className="mt-4">
          <label className="label" htmlFor="ap-wk">Tydzień zaczynający się {dmy(addDays(from, 1 - weekday(from)))} to</label>
          <select id="ap-wk" className="input" value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))}>
            {Array.from({ length: template.weeks }, (_, i) => (
              <option key={i} value={i + 1}>tydzień {i + 1} szablonu</option>
            ))}
          </select>
        </div>
      )}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <span>
          Zastąp już wpisane dni pracy i dni wolne
          <span className="block text-xs text-muted">Urlopy, L4 i święta zawsze zostają. Dni, w które salon jest nieczynny, są pomijane.</span>
        </span>
      </label>
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Wyczyść okres ---------------- */

function ClearDialog({
  staffId,
  defaultFrom,
  defaultTo,
  onClose,
  onDone,
}: {
  staffId: string;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const { data, error } = await createClient().rpc("clear_schedule", { p_staff_id: staffId, p_from: from, p_to: to, p_all: all });
    if (error) return setError(errText(error));
    onDone(Number(data ?? 0));
  }
  return (
    <Modal
      title="Wyczyść grafik w okresie"
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={run}>Wyczyść</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="cl-from">Od</label>
          <input id="cl-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cl-to">Do</label>
          <input id="cl-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Usuń też urlopy, L4 i święta
      </label>
      <ErrorBox error={error} />
    </Modal>
  );
}
