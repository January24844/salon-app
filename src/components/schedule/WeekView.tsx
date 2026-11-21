"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import ScheduleCell, { hoursFmt } from "./Cell";
import DayDialog from "./DayDialog";
import { resolveDay } from "@/components/calendar/schedule";
import type { ScheduleDay, Staff, WorkingHours } from "@/lib/types";
import { addDays, isoWeek, todayStr } from "@/lib/time";

export const DAY_NAMES = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
export const dmy = (d: string) => d.split("-").reverse().join(".");

export default function WeekView({
  monday,
  staff,
  hours,
  schedule,
  closedWeekdays,
  isOwner,
}: {
  monday: string;
  staff: Staff[];
  hours: WorkingHours[];
  schedule: ScheduleDay[];
  closedWeekdays: number[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ staff: Staff; date: string } | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const today = todayStr();

  function exportCsv() {
    const rows = [["Pracownik", ...days.map((d, i) => `${DAY_NAMES[i]} ${dmy(d)}`), "Suma godzin"]];
    for (const s of staff) {
      const res = days.map((d) => resolveDay(s.id, d, hours, schedule, closedWeekdays));
      rows.push([
        s.full_name,
        ...res.map((r) => (r.kind === "work" ? r.label : r.kind === "none" ? "" : r.label)),
        hoursFmt(res.reduce((n, r) => n + r.minutes, 0)),
      ]);
    }
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `grafik-tydzien-${isoWeek(monday)}-${monday}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-w-0 flex-1 px-4 py-6">
      <h1 className="font-serif text-3xl">
        <span className="text-muted">Grafiki pracowników /</span> {isoWeek(monday)} tydzień
      </h1>

      <div className="my-5 flex flex-wrap items-center gap-2">
        <div className="flex">
          <Link href={`/panel/grafik?w=${addDays(monday, -7)}`} className="btn-secondary rounded-r-none px-3" aria-label="Poprzedni tydzień">‹</Link>
          <Link href={`/panel/grafik?w=${addDays(monday, 7)}`} className="btn-secondary -ml-px rounded-l-none px-3" aria-label="Następny tydzień">›</Link>
        </div>
        <input
          type="date"
          className="input w-auto"
          value={monday}
          onChange={(e) => e.target.value && router.push(`/panel/grafik?w=${e.target.value}`)}
          aria-label="Wybierz tydzień"
        />
        <span className="text-sm text-muted">
          {dmy(monday)} – {dmy(days[6])}
        </span>
        <Link href={`/panel/grafik?w=${today}`} className="btn-secondary">Dzisiaj</Link>
        <div className="ml-auto flex gap-2">
          {isOwner && (
            <button className="btn-ghost text-sm" onClick={() => setClosedOpen(true)}>Dni nieczynne salonu</button>
          )}
          <button className="btn-secondary text-sm" onClick={exportCsv}>Pobierz grafik (Excel)</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] table-fixed text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-40 px-3 py-2"></th>
              {days.map((d, i) => (
                <th key={d} className={`px-1.5 py-2 text-center font-medium ${d === today ? "text-accent" : ""}`}>
                  {DAY_NAMES[i]}
                  <span className="block font-semibold tabular-nums">{dmy(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((s) => {
              const res = days.map((d) => resolveDay(s.id, d, hours, schedule, closedWeekdays));
              const total = res.reduce((n, r) => n + r.minutes, 0);
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/panel/grafik/${s.id}`} className="font-medium text-accent hover:underline">{s.full_name}</Link>
                    <span className="block font-semibold">{hoursFmt(total)}</span>
                  </td>
                  {res.map((r, i) => (
                    <td key={days[i]} className="p-1.5 align-top">
                      <ScheduleCell day={r} color={s.color} highlight={days[i] === today} onClick={() => setEdit({ staff: s, date: days[i] })} />
                    </td>
                  ))}
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">Brak aktywnych pracownic.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Kliknij komórkę, żeby zmienić dzień. Ramka przerywana = dzień ze stałego grafiku tygodniowego. Szablony i wstawianie
        grafiku na dłuższy okres znajdziesz po kliknięciu w imię pracownicy.
      </p>

      {edit && (() => {
        const r = resolveDay(edit.staff.id, edit.date, hours, schedule, closedWeekdays);
        const weekly = resolveDay(edit.staff.id, edit.date, hours, [], closedWeekdays);
        return (
          <DayDialog
            staffId={edit.staff.id}
            staffName={edit.staff.full_name}
            date={edit.date}
            current={r.override}
            defaultLabel={weekly.kind === "none" ? "brak grafiku" : weekly.label}
            onClose={() => setEdit(null)}
            onSaved={() => {
              setEdit(null);
              router.refresh();
            }}
          />
        );
      })()}
      {closedOpen && (
        <ClosedDaysDialog
          current={closedWeekdays}
          onClose={() => setClosedOpen(false)}
          onSaved={() => {
            setClosedOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ClosedDaysDialog({ current, onClose, onSaved }: { current: number[]; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<number[]>(current);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const { error } = await createClient().from("salon_settings").update({ closed_weekdays: sel.sort() }).eq("id", 1);
    if (error) return setError(errText(error));
    onSaved();
  }
  return (
    <Modal
      title="Dni, w które salon jest nieczynny"
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        W te dni w grafiku widać „Salon nieczynny”, a szablony ich nie wypełniają. Pojedynczy dzień pracy (np. wyjątkowa
        niedziela) i tak możesz wpisać ręcznie.
      </p>
      <div className="grid grid-cols-2 gap-1 text-sm">
        {DAY_NAMES.map((d, i) => (
          <label key={d} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent-soft">
            <input
              type="checkbox"
              checked={sel.includes(i + 1)}
              onChange={(e) => setSel((s) => (e.target.checked ? [...s, i + 1] : s.filter((x) => x !== i + 1)))}
            />
            {d}
          </label>
        ))}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
