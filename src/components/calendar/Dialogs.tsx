"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type { Appointment, AppointmentStatus, DayNote, Label, PaymentMethod, Room, ScheduleDay, Staff } from "@/lib/types";
import { STATUS_LABEL, clientName } from "@/lib/types";
import { formatDayLong, money, toZoned } from "@/lib/time";

/* ---------------- Szczegóły wizyty ---------------- */

export function AppointmentDetails({
  appt,
  staff,
  rooms,
  labels,
  methods,
  isOwner,
  onClose,
  onEdit,
  onFinalize,
  onChanged,
}: {
  appt: Appointment;
  staff: Staff[];
  rooms: Room[];
  labels: Label[];
  methods: PaymentMethod[];
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onFinalize: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = toZoned(appt.starts_at);
  const e = toZoned(appt.ends_at);
  const who = staff.find((x) => x.id === appt.staff_id);
  const open = appt.status === "booked" || appt.status === "confirmed";
  const total = appt.appointment_services.reduce((n, x) => n + Number(x.price), 0);

  async function setStatus(status: AppointmentStatus) {
    setBusy(true);
    const { error } = await createClient().from("appointments").update({ status }).eq("id", appt.id);
    setBusy(false);
    if (error) return setError(errText(error));
    onChanged();
  }

  async function unfinalize() {
    setBusy(true);
    const { error } = await createClient().rpc("unfinalize_appointment", { p_id: appt.id });
    setBusy(false);
    if (error) return setError(errText(error));
    onChanged();
  }

  return (
    <Modal
      title={
        <span>
          {clientName(appt.client)}{" "}
          <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-normal">{STATUS_LABEL[appt.status]}</span>
        </span>
      }
      onClose={onClose}
      footer={
        open ? (
          <>
            <button className="btn-primary" onClick={onFinalize} disabled={busy}>Finalizuj</button>
            <button className="btn-secondary" onClick={onEdit} disabled={busy}>Edytuj</button>
            {appt.status === "booked" && (
              <button className="btn-ghost text-sm" onClick={() => setStatus("confirmed")} disabled={busy}>Potwierdź</button>
            )}
            <button className="btn-ghost text-sm" onClick={() => setStatus("no_show")} disabled={busy}>Nie przyszła</button>
            {confirmCancel ? (
              <button className="btn-ghost text-sm text-red-600" onClick={() => setStatus("cancelled")} disabled={busy}>
                Na pewno odwołać?
              </button>
            ) : (
              <button className="btn-ghost text-sm" onClick={() => setConfirmCancel(true)}>Odwołaj</button>
            )}
          </>
        ) : (
          <>
            {appt.status === "no_show" && (
              <button className="btn-secondary" onClick={() => setStatus("booked")} disabled={busy}>Przywróć wizytę</button>
            )}
            {appt.status === "completed" && isOwner && (
              <button className="btn-secondary" onClick={unfinalize} disabled={busy}>Cofnij finalizację</button>
            )}
            <button className="btn-ghost" onClick={onClose}>Zamknij</button>
          </>
        )
      }
    >
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Termin</dt>
        <dd>
          {formatDayLong(s.date)}, <strong>{s.time} – {e.time}</strong>
        </dd>
        <dt className="text-muted">Pracownica</dt>
        <dd>
          {who?.full_name ?? "—"}
          {appt.room_id && <span className="text-muted"> · {rooms.find((r) => r.id === appt.room_id)?.name}</span>}
        </dd>
        <dt className="text-muted">Kontakt</dt>
        <dd>
          {appt.client?.phone ? <a className="text-accent" href={`tel:${appt.client.phone}`}>{appt.client.phone}</a> : "—"}
          {appt.client?.email && <span className="ml-2 text-muted">{appt.client.email}</span>}
          {appt.client && (
            <Link className="ml-3 text-accent underline-offset-2 hover:underline" href={`/panel/klientki/${appt.client.id}`}>
              karta klientki →
            </Link>
          )}
        </dd>
        <dt className="text-muted">Usługi</dt>
        <dd>
          <ul>
            {[...appt.appointment_services]
              .sort((a, b) => a.position - b.position)
              .map((x, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{x.service?.name}</span>
                  <span className="whitespace-nowrap text-muted">{x.duration_minutes} min · {money(x.price)}</span>
                </li>
              ))}
          </ul>
          <p className="mt-1 text-right font-medium">Razem {money(appt.status === "completed" ? appt.price : total)}</p>
        </dd>
        {Number(appt.deposit_amount) > 0 && (
          <>
            <dt className="text-muted">Przedpłata</dt>
            <dd>
              {money(appt.deposit_amount)} ({methods.find((m) => m.code === appt.deposit_method)?.name ?? appt.deposit_method})
            </dd>
          </>
        )}
        {appt.appointment_labels.length > 0 && (
          <>
            <dt className="text-muted">Etykiety</dt>
            <dd className="flex flex-wrap gap-1">
              {appt.appointment_labels.map((l) => {
                const lab = labels.find((x) => x.id === l.label_id);
                return lab ? (
                  <span key={l.label_id} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: lab.color }}>
                    {lab.name}
                  </span>
                ) : null;
              })}
            </dd>
          </>
        )}
        {appt.staff_note && (
          <>
            <dt className="text-muted">Opis</dt>
            <dd className="whitespace-pre-wrap">{appt.staff_note}</dd>
          </>
        )}
        {appt.client_note && (
          <>
            <dt className="text-muted">Uwagi klientki</dt>
            <dd className="whitespace-pre-wrap">{appt.client_note}</dd>
          </>
        )}
      </dl>
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Finalizacja ---------------- */

export function FinalizeDialog({
  appt,
  methods,
  onClose,
  onDone,
}: {
  appt: Appointment;
  methods: PaymentMethod[];
  onClose: () => void;
  onDone: () => void;
}) {
  const total = appt.appointment_services.reduce((n, x) => n + Number(x.price), 0);
  const dep = Math.min(Number(appt.deposit_amount ?? 0), total);
  const [lines, setLines] = useState<{ method: string; amount: number }[]>(() => {
    const l: { method: string; amount: number }[] = [];
    if (dep > 0) l.push({ method: "przedplata", amount: dep });
    if (total - dep > 0 || l.length === 0) l.push({ method: "gotowka", amount: total - dep });
    return l;
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paid = lines.reduce((n, l) => n + Number(l.amount || 0), 0);
  const usable = methods.filter((m) => m.code !== "przedplata" || dep > 0);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("finalize_appointment", {
      p_id: appt.id,
      p_payments: lines,
      p_note: note || null,
    });
    setBusy(false);
    if (error) return setError(errText(error));
    onDone();
  }

  return (
    <Modal
      title={`Finalizacja – ${clientName(appt.client)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zakończ wizytę"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <p className="text-sm text-muted">Do zapłaty za usługi</p>
      <p className="font-serif text-3xl">{money(total)}</p>

      <span className="label mt-5">Płatność</span>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <select
              className="input flex-1"
              value={l.method}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}
              aria-label="Metoda płatności"
            >
              {usable.map((m) => (
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
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: +e.target.value } : x)))}
              aria-label="Kwota"
            />
            <span className="text-sm text-muted">zł</span>
            {lines.length > 1 && (
              <button className="btn-ghost px-2" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Usuń">×</button>
            )}
          </li>
        ))}
      </ul>
      <button
        className="mt-2 text-sm text-accent hover:underline"
        onClick={() => setLines((ls) => [...ls, { method: "karta", amount: Math.max(0, total - paid) }])}
      >
        + podziel płatność
      </button>
      {Math.abs(paid - total) > 0.009 && (
        <p className="mt-3 text-sm text-muted">
          Suma płatności: <strong>{money(paid)}</strong> ({paid < total ? `rabat ${money(total - paid)}` : `więcej o ${money(paid - total)}`}).
        </p>
      )}

      <label className="label mt-5" htmlFor="fin-note">Notatka z zabiegu (opcjonalnie)</label>
      <textarea id="fin-note" rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. użyte produkty, efekt, zalecenia" />
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Grafik pracownicy na dany dzień ---------------- */

export function DayScheduleDialog({
  staff,
  date,
  current,
  weeklyLabel,
  onClose,
  onSaved,
}: {
  staff: Staff;
  date: string;
  current: ScheduleDay | null;
  weeklyLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"weekly" | "off" | "hours">(current ? (current.is_day_off ? "off" : "hours") : "weekly");
  const [start, setStart] = useState(current?.start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(current?.end_time?.slice(0, 5) ?? "17:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const res =
      mode === "weekly"
        ? await supabase.from("staff_schedule_days").delete().eq("staff_id", staff.id).eq("day", date)
        : await supabase.from("staff_schedule_days").upsert(
            {
              staff_id: staff.id,
              day: date,
              is_day_off: mode === "off",
              start_time: mode === "hours" ? start : null,
              end_time: mode === "hours" ? end : null,
            },
            { onConflict: "staff_id,day" },
          );
    setBusy(false);
    if (res.error) return setError(errText(res.error));
    onSaved();
  }

  return (
    <Modal
      title={`Grafik: ${staff.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>Zapisz</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">{formatDayLong(date)}</p>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "weekly"} onChange={() => setMode("weekly")} />
          Stały grafik tygodniowy {weeklyLabel ? `(${weeklyLabel})` : "(nieustawiony)"}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "off"} onChange={() => setMode("off")} />
          Dzień wolny
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" checked={mode === "hours"} onChange={() => setMode("hours")} />
          Pracuje w godzinach
          <input type="time" step={900} className="input w-28" value={start} onChange={(e) => { setStart(e.target.value); setMode("hours"); }} aria-label="Od" />
          –
          <input type="time" step={900} className="input w-28" value={end} onChange={(e) => { setEnd(e.target.value); setMode("hours"); }} aria-label="Do" />
        </label>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

/* ---------------- Notatki na cały dzień ---------------- */

export function DayNotesDialog({
  date,
  staff,
  notes,
  onClose,
  onSaved,
}: {
  date: string;
  staff: Staff | null;
  notes: DayNote[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mine = notes.filter((n) => n.staff_id === (staff?.id ?? null));

  async function add() {
    if (!text.trim()) return;
    const { error } = await createClient().from("calendar_day_notes").insert({ day: date, staff_id: staff?.id ?? null, text: text.trim() });
    if (error) return setError(errText(error));
    setText("");
    onSaved();
  }
  async function remove(id: string) {
    const { error } = await createClient().from("calendar_day_notes").delete().eq("id", id);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal title={`Notatki dnia – ${staff ? staff.full_name : "cały salon"}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{formatDayLong(date)}</p>
      {mine.length > 0 && (
        <ul className="mb-3 space-y-2">
          {mine.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              <span className="flex-1 whitespace-pre-wrap">{n.text}</span>
              <button className="text-muted hover:text-foreground" onClick={() => remove(n.id)} aria-label="Usuń notatkę">×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="np. szkolenie, wcześniejsze wyjście, dostawa"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Treść notatki"
        />
        <button className="btn-primary" onClick={add}>Dodaj</button>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
