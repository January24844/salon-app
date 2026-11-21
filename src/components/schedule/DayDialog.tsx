"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type { DayKind, ScheduleDay } from "@/lib/types";
import { formatDayLong } from "@/lib/time";

type Mode = "default" | DayKind;

/** Edycja jednego dnia w grafiku pracownicy (z kalendarza lub z ekranu Grafik). */
export default function DayDialog({
  staffId,
  staffName,
  date,
  current,
  defaultLabel,
  onClose,
  onSaved,
}: {
  staffId: string;
  staffName: string;
  date: string;
  current: ScheduleDay | null;
  /** co obowiązuje bez wpisu, np. "stały grafik: 9:00 - 17:00" albo "brak grafiku" */
  defaultLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentKind: DayKind | null = current ? (current.kind ?? (current.is_day_off ? "off" : "work")) : null;
  const [mode, setMode] = useState<Mode>(currentKind ?? "work");
  const [start, setStart] = useState(current?.start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(current?.end_time?.slice(0, 5) ?? "17:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (mode === "work" && end <= start) return setError("Godzina końca musi być późniejsza niż początku.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const res =
      mode === "default"
        ? await supabase.from("staff_schedule_days").delete().eq("staff_id", staffId).eq("day", date)
        : await supabase.from("staff_schedule_days").upsert(
            {
              staff_id: staffId,
              day: date,
              kind: mode,
              is_day_off: mode !== "work",
              start_time: mode === "work" ? start : null,
              end_time: mode === "work" ? end : null,
            },
            { onConflict: "staff_id,day" },
          );
    setBusy(false);
    if (res.error) return setError(errText(res.error));
    onSaved();
  }

  const opt = (m: Mode, label: React.ReactNode) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent-soft">
      <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
      {label}
    </label>
  );

  return (
    <Modal
      title={`Grafik: ${staffName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted first-letter:uppercase">{formatDayLong(date)}</p>
      <div className="space-y-0.5 text-sm">
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent-soft">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={mode === "work"} onChange={() => setMode("work")} />
            Pracuje
          </label>
          <input type="time" step={900} className="input w-28" value={start} onChange={(e) => { setStart(e.target.value); setMode("work"); }} aria-label="Od" />
          –
          <input type="time" step={900} className="input w-28" value={end} onChange={(e) => { setEnd(e.target.value); setMode("work"); }} aria-label="Do" />
        </div>
        {opt("off", "Dzień wolny")}
        {opt("vacation", "Urlop")}
        {opt("sick", "L4 / choroba")}
        {opt("holiday", "Święto")}
        {current && opt("default", <span className="text-muted">Usuń wpis ({defaultLabel})</span>)}
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
