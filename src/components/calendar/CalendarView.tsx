"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  Appointment,
  Category,
  DayNote,
  Label,
  PaymentMethod,
  Room,
  ScheduleDay,
  Service,
  Staff,
  WorkingHours,
} from "@/lib/types";
import { clientName } from "@/lib/types";
import { addDays, formatDayLong, isoWeek, minToTime, timeToMin, toZoned, todayStr, zonedToUtc } from "@/lib/time";
import AppointmentForm, { type FormInit } from "./AppointmentForm";
import { AppointmentDetails, DayNotesDialog, DayScheduleDialog, FinalizeDialog } from "./Dialogs";
import MiniMonth from "./MiniMonth";
import { workIntervals, type Interval } from "./schedule";
import { errText } from "@/components/Modal";

const PX = 1.4; // pikseli na minutę → 84 px na godzinę
const SNAP = 5; // minuty

type Dialog =
  | { kind: "form"; init: FormInit }
  | { kind: "details"; id: string }
  | { kind: "finalize"; id: string }
  | { kind: "schedule"; staffId: string }
  | { kind: "notes"; staffId: string | null }
  | null;

export type CalendarData = {
  date: string;
  staff: Staff[];
  hours: WorkingHours[];
  schedule: ScheduleDay[];
  appointments: Appointment[];
  services: Service[];
  categories: Category[];
  labels: Label[];
  methods: PaymentMethod[];
  notes: DayNote[];
  rooms: Room[];
  serviceRooms: { service_id: string; room_id: string }[];
  calendarStart: string;
  calendarEnd: string;
  isOwner: boolean;
};

export default function CalendarView(props: CalendarData) {
  const { date, staff, rooms, hours, schedule, appointments, labels, methods, notes, isOwner } = props;
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [now, setNow] = useState<{ date: string; minutes: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSide, setShowSide] = useState(false);

  // ukryte pracownice zapamiętane w przeglądarce
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cal-hidden-staff") ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(saved)) setHidden(saved);
    } catch {}
  }, []);
  const toggleStaff = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      try {
        localStorage.setItem("cal-hidden-staff", JSON.stringify(next));
      } catch {}
      return next;
    });

  // czerwona linia "teraz"
  useEffect(() => {
    const tick = () => setNow(toZoned(new Date()));
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);

  const visible = staff.filter((s) => !hidden.includes(s.id));
  const visibleRooms = rooms.filter((r) => !hidden.includes(r.id));

  // zakres godzin: z ustawień, poszerzony jeśli jakaś wizyta wychodzi poza
  const [rangeStart, rangeEnd] = useMemo(() => {
    let a = timeToMin(props.calendarStart);
    let b = timeToMin(props.calendarEnd);
    for (const x of appointments) {
      a = Math.min(a, Math.floor(toZoned(x.starts_at).minutes / 60) * 60);
      const e = toZoned(x.ends_at);
      b = Math.max(b, e.date !== date ? 24 * 60 : Math.ceil(e.minutes / 60) * 60);
    }
    return [a, b];
  }, [appointments, props.calendarStart, props.calendarEnd, date]);
  const fallback: Interval = [timeToMin(props.calendarStart), timeToMin(props.calendarEnd)];
  const height = (rangeEnd - rangeStart) * PX;

  type Col = { kind: "staff" | "room"; id: string; name: string; color: string; label: string; intervals: Interval[] };
  const cols: Col[] = [
    ...visible.map((s) => {
      const w = workIntervals(s.id, date, hours, schedule, fallback);
      return { kind: "staff" as const, id: s.id, name: s.full_name, color: s.color, label: w.label || "ustaw grafik", intervals: w.intervals };
    }),
    ...visibleRooms.map((r) => ({
      kind: "room" as const,
      id: r.id,
      name: r.name,
      color: r.color,
      label: `${r.open_time.slice(0, 5)} - ${r.close_time.slice(0, 5)}`,
      intervals: [[timeToMin(r.open_time), timeToMin(r.close_time)] as Interval],
    })),
  ];
  const inCol = (a: Appointment, c: Col) => (c.kind === "staff" ? a.staff_id === c.id : a.room_id === c.id);
  const hoursList = Array.from({ length: (rangeEnd - rangeStart) / 60 }, (_, i) => rangeStart + i * 60);

  const refresh = () => {
    setDialog(null);
    router.refresh();
  };
  const byId = (id: string) => appointments.find((a) => a.id === id);

  /* ----- przeciąganie wizyt ----- */
  const drag = useRef<{
    appt: Appointment;
    startY: number;
    startMin: number;
    moved: boolean;
    el: HTMLElement;
  } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; kind: "staff" | "room"; colId: string; minutes: number } | null>(null);
  const [hover, setHover] = useState<{ key: string; minutes: number } | null>(null);

  function onBlockPointerDown(e: React.PointerEvent<HTMLElement>, appt: Appointment) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const open = appt.status === "booked" || appt.status === "confirmed";
    drag.current = { appt, startY: e.clientY, startMin: toZoned(appt.starts_at).minutes, moved: false, el: e.currentTarget };
    if (open) e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onBlockPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !(d.appt.status === "booked" || d.appt.status === "confirmed")) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    const minutes = Math.max(rangeStart, Math.round((d.startMin + dy / PX) / SNAP) * SNAP);
    const col = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el) => (el as HTMLElement).dataset?.colId) as HTMLElement | undefined;
    const kind = (col?.dataset.colKind as "staff" | "room" | undefined) ?? "staff";
    setGhost({ id: d.appt.id, kind, colId: col?.dataset.colId ?? d.appt.staff_id, minutes });
  }
  async function onBlockPointerUp(appt: Appointment) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setDialog({ kind: "details", id: appt.id });
      return;
    }
    const g = ghost;
    setGhost(null);
    if (!g) return;
    const oldStart = toZoned(appt.starts_at).minutes;
    const newStaff = g.kind === "staff" ? g.colId : appt.staff_id;
    const newRoom = g.kind === "room" ? g.colId : appt.room_id;
    if (g.minutes === oldStart && newStaff === appt.staff_id && newRoom === appt.room_id) return;
    const dur = (Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60000;
    const start = zonedToUtc(date, minToTime(g.minutes));
    const { error } = await createClient().rpc("save_appointment", {
      p: {
        id: appt.id,
        client_id: appt.client?.id,
        staff_id: newStaff,
        room_id: newRoom,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + dur * 60000).toISOString(),
        services: [...appt.appointment_services]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ service_id: s.service_id, duration_minutes: s.duration_minutes, price: s.price, client_package_id: s.client_package_id })),
        labels: appt.appointment_labels.map((l) => l.label_id),
        note: appt.staff_note,
        deposit: appt.deposit_amount ? { amount: appt.deposit_amount, method: appt.deposit_method } : null,
      },
    });
    if (error) {
      setToast(errText(error));
      setTimeout(() => setToast(null), 5000);
    }
    router.refresh();
  }

  /* ----- kliknięcie w pusty pasek ----- */
  const minutesAt = (e: React.MouseEvent<HTMLDivElement>) =>
    rangeStart + Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / PX / SNAP) * SNAP;
  function onColumnClick(e: React.MouseEvent<HTMLDivElement>, c: Col) {
    const time = minToTime(minutesAt(e));
    if (c.kind === "staff") setDialog({ kind: "form", init: { staffId: c.id, date, time } });
    else setDialog({ kind: "form", init: { staffId: visible[0]?.id ?? staff[0]?.id, roomId: c.id, date, time } });
  }

  const isToday = now?.date === date;
  const salonNotes = notes.filter((n) => !n.staff_id);

  return (
    <div className="flex flex-1">
      {/* ---------- panel boczny ---------- */}
      <aside
        className={`${showSide ? "fixed inset-y-0 left-0 z-40 block w-72 shadow-xl" : "hidden"} shrink-0 border-r border-border bg-card p-4 lg:static lg:block lg:w-64 lg:shadow-none print:hidden`}
      >
        <div className="mb-3 flex justify-end lg:hidden">
          <button className="btn-ghost" onClick={() => setShowSide(false)}>Zamknij ×</button>
        </div>
        <MiniMonth key={date.slice(0, 7)} selected={date} />
        <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Pracownicy</h2>
        <ul className="space-y-1">
          {staff.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent-soft">
                <input type="checkbox" checked={!hidden.includes(s.id)} onChange={() => toggleStaff(s.id)} />
                <span className="flex-1">{s.full_name}</span>
                <span className="size-3.5 rounded-sm" style={{ background: s.color }} />
              </label>
            </li>
          ))}
        </ul>
        {staff.length === 0 && (
          <p className="text-sm text-muted">
            Brak pracownic. <Link className="text-accent underline" href="/panel/pracownice">Dodaj</Link>
          </p>
        )}
        {rooms.length > 0 && (
          <>
            <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Gabinety i urządzenia</h2>
            <ul className="space-y-1">
              {rooms.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent-soft">
                    <input type="checkbox" checked={!hidden.includes(r.id)} onChange={() => toggleStaff(r.id)} />
                    <span className="flex-1">{r.name}</span>
                    <span className="size-3.5 rounded-sm" style={{ background: r.color }} />
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {/* ---------- kalendarz ---------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 print:hidden">
          <button className="btn-secondary px-3 lg:hidden" onClick={() => setShowSide(true)} aria-label="Kalendarz i pracownice">☰</button>
          <div className="flex">
            <Link href={`/panel?d=${addDays(date, -1)}`} className="btn-secondary rounded-r-none px-3" aria-label="Poprzedni dzień">‹</Link>
            <Link href={`/panel?d=${addDays(date, 1)}`} className="btn-secondary -ml-px rounded-l-none px-3" aria-label="Następny dzień">›</Link>
          </div>
          <Link href={`/panel?d=${todayStr()}`} className="btn-secondary">dzisiaj</Link>
          <h1 className="ml-1 text-lg font-medium first-letter:uppercase">{formatDayLong(date)}</h1>
          <span className="text-sm text-muted">tydz. {isoWeek(date)}</span>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost text-sm" onClick={() => window.print()}>Drukuj</button>
            <button
              className="btn-primary"
              onClick={() => setDialog({ kind: "form", init: { staffId: visible[0]?.id ?? staff[0]?.id, date, time: isToday && now ? minToTime(Math.ceil(now.minutes / 15) * 15) : minToTime(fallback[0]) } })}
              disabled={!staff.length}
            >
              + Nowa wizyta
            </button>
          </div>
        </div>

        {salonNotes.length > 0 && (
          <button
            onClick={() => setDialog({ kind: "notes", staffId: null })}
            className="mx-4 mt-3 rounded-lg bg-accent-soft px-3 py-2 text-left text-sm"
          >
            📌 {salonNotes.map((n) => n.text).join(" · ")}
          </button>
        )}

        <div className="flex-1 overflow-auto">
          <div className="min-w-max" style={{ ["--cols" as string]: visible.length }}>
            {/* nagłówki */}
            <div className="sticky top-0 z-20 flex border-b border-border bg-card">
              <div className="w-14 shrink-0 border-r border-border px-1 py-2 text-center text-xs text-muted">
                <button className="hover:text-foreground" onClick={() => setDialog({ kind: "notes", staffId: null })} title="Notatka dla całego salonu">
                  dzień
                </button>
              </div>
              {cols.map((c) => {
                const dayNotes = c.kind === "staff" ? notes.filter((n) => n.staff_id === c.id) : [];
                return (
                  <div key={c.kind + c.id} className={`w-40 shrink-0 border-r border-border sm:w-auto sm:min-w-32 sm:flex-1 ${c.kind === "room" ? "bg-accent-soft/40" : ""}`}>
                    {c.kind === "staff" ? (
                      <button
                        className="w-full px-2 pt-2 text-center hover:bg-accent-soft"
                        onClick={() => setDialog({ kind: "schedule", staffId: c.id })}
                        title="Zmień grafik na ten dzień"
                      >
                        <span className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                          <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </span>
                        <span className="block pb-1 text-xs text-muted">{c.label}</span>
                      </button>
                    ) : (
                      <div className="px-2 pt-2 text-center">
                        <span className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                          <span className="size-2.5 rounded-sm" style={{ background: c.color }} />
                          {c.name}
                        </span>
                        <span className="block pb-1 text-xs text-muted">{c.label}</span>
                      </div>
                    )}
                    {c.kind === "staff" ? (
                      <button
                        onClick={() => setDialog({ kind: "notes", staffId: c.id })}
                        className="block min-h-6 w-full border-t border-border px-2 py-1 text-left text-xs text-muted hover:bg-accent-soft"
                        title="Notatka na cały dzień"
                      >
                        {dayNotes.map((n) => n.text).join(" · ")}
                      </button>
                    ) : (
                      <div className="min-h-6 border-t border-border" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* siatka */}
            <div className="flex">
              <div className="relative w-14 shrink-0 border-r border-border" style={{ height }}>
                {hoursList.map((m) => (
                  <span key={m} className="absolute right-1.5 -translate-y-0.5 text-xs text-muted" style={{ top: (m - rangeStart) * PX + 2 }}>
                    {minToTime(m)}
                  </span>
                ))}
              </div>
              {cols.map((c) => {
                const key = c.kind + c.id;
                const mine = appointments.filter((a) => inCol(a, c));
                const ghostAppt = ghost && ghost.kind === c.kind && ghost.colId === c.id ? byId(ghost.id) : null;
                const staffOf = (a: Appointment) => staff.find((x) => x.id === a.staff_id);
                return (
                  <div
                    key={key}
                    data-col-id={c.id}
                    data-col-kind={c.kind}
                    className="relative w-40 shrink-0 cursor-cell border-r border-border bg-foreground/[0.06] sm:w-auto sm:min-w-32 sm:flex-1"
                    style={{ height }}
                    onClick={(e) => onColumnClick(e, c)}
                    onMouseMove={(e) => {
                      const m = minutesAt(e);
                      if (hover?.key !== key || hover.minutes !== m) setHover({ key, minutes: m });
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* godziny pracy / otwarcia = białe tło */}
                    {c.intervals.map(([a, b], i) => (
                      <div
                        key={i}
                        className="pointer-events-none absolute inset-x-0 bg-card"
                        style={{ top: (Math.max(a, rangeStart) - rangeStart) * PX, height: Math.max(0, Math.min(b, rangeEnd) - Math.max(a, rangeStart)) * PX }}
                      />
                    ))}
                    {/* linie co 15 min i co godzinę */}
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${15 * PX}px), repeating-linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 22%, transparent) 0 1px, transparent 1px ${60 * PX}px)`,
                      }}
                    />
                    {hover?.key === key && !ghost && (
                      <span
                        className="pointer-events-none absolute left-1 z-[1] text-[11px] text-muted tabular-nums"
                        style={{ top: (hover.minutes - rangeStart) * PX }}
                      >
                        {minToTime(hover.minutes)}
                      </span>
                    )}
                    {mine.map((a) => (
                      <Block
                        key={a.id}
                        appt={a}
                        color={c.color}
                        subtitle={c.kind === "room" ? staffOf(a)?.full_name : undefined}
                        rangeStart={rangeStart}
                        labels={labels}
                        dimmed={ghost?.id === a.id}
                        onPointerDown={(e) => onBlockPointerDown(e, a)}
                        onPointerMove={onBlockPointerMove}
                        onPointerUp={() => onBlockPointerUp(a)}
                      />
                    ))}
                    {ghostAppt && ghost && (
                      <Block
                        appt={ghostAppt}
                        color={c.color}
                        rangeStart={rangeStart}
                        labels={labels}
                        overrideStart={ghost.minutes}
                        ghost
                        onPointerDown={() => {}}
                        onPointerMove={onBlockPointerMove}
                        onPointerUp={() => onBlockPointerUp(ghostAppt)}
                      />
                    )}
                    {isToday && now && now.minutes >= rangeStart && now.minutes <= rangeEnd && (
                      <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500" style={{ top: (now.minutes - rangeStart) * PX }} />
                    )}
                  </div>
                );
              })}
              {cols.length === 0 && (
                <div className="flex-1 p-8 text-center text-muted">Zaznacz pracownice w panelu po lewej.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">{toast}</div>
      )}

      {/* ---------- okna ---------- */}
      {dialog?.kind === "form" && (
        <AppointmentForm
          init={dialog.init}
          staff={staff}
          services={props.services}
          categories={props.categories}
          labels={labels}
          methods={methods}
          hours={hours}
          rooms={rooms}
          serviceRooms={props.serviceRooms}
          calendarRange={fallback}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
      {dialog?.kind === "details" && byId(dialog.id) && (
        <AppointmentDetails
          appt={byId(dialog.id)!}
          staff={staff}
          rooms={rooms}
          labels={labels}
          methods={methods}
          isOwner={isOwner}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onFinalize={() => setDialog({ kind: "finalize", id: dialog.id })}
          onEdit={() => {
            const a = byId(dialog.id)!;
            const z = toZoned(a.starts_at);
            setDialog({ kind: "form", init: { staffId: a.staff_id, roomId: a.room_id, date: z.date, time: z.time, appointment: a } });
          }}
        />
      )}
      {dialog?.kind === "finalize" && byId(dialog.id) && (
        <FinalizeDialog appt={byId(dialog.id)!} methods={methods} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === "schedule" && (() => {
        const s = staff.find((x) => x.id === dialog.staffId)!;
        const w = workIntervals(s.id, date, hours, schedule, fallback);
        const weekly = workIntervals(s.id, date, hours, [], fallback);
        return (
          <DayScheduleDialog
            staff={s}
            date={date}
            current={w.override}
            weeklyLabel={hours.some((h) => h.staff_id === s.id) ? weekly.label : ""}
            onClose={() => setDialog(null)}
            onSaved={refresh}
          />
        );
      })()}
      {dialog?.kind === "notes" && (
        <DayNotesDialog
          date={date}
          staff={staff.find((x) => x.id === dialog.staffId) ?? null}
          notes={notes}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

/* ---------------- blok wizyty ---------------- */

function Block({
  appt,
  color,
  rangeStart,
  labels,
  overrideStart,
  ghost,
  dimmed,
  subtitle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  appt: Appointment;
  color: string;
  rangeStart: number;
  labels: Label[];
  overrideStart?: number;
  ghost?: boolean;
  dimmed?: boolean;
  subtitle?: string;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
}) {
  const s = toZoned(appt.starts_at);
  const e = toZoned(appt.ends_at);
  const dur = Math.round((Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60000);
  const start = overrideStart ?? s.minutes;
  const top = (start - rangeStart) * PX;
  const h = Math.max(dur * PX, 18);
  const done = appt.status === "completed";
  const noShow = appt.status === "no_show";
  const names = [...appt.appointment_services].sort((a, b) => a.position - b.position).map((x) => x.service?.name).join(", ");
  const tags = appt.appointment_labels.map((l) => labels.find((x) => x.id === l.label_id)).filter(Boolean);

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(ev) => ev.stopPropagation()}
      className={`absolute inset-x-1 z-[5] touch-none overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm transition ${
        ghost ? "z-20 opacity-80 ring-2 ring-accent" : "hover:z-20 hover:shadow-md"
      } ${noShow || dimmed ? "opacity-40" : ""} ${ghost ? "pointer-events-none" : ""}`}
      style={{
        top,
        height: h,
        borderLeftColor: color,
        background: `color-mix(in srgb, ${color} ${done ? 22 : 45}%, var(--card))`,
        color: "var(--foreground)",
      }}
      title={`${s.time}–${e.time} ${clientName(appt.client)}\n${names}`}
    >
      <span className="absolute inset-x-1.5 top-0.5 block">
      <span className="font-semibold tabular-nums">
        {overrideStart !== undefined ? `${minToTime(start)}–${minToTime(start + dur)}` : `${s.time}–${e.time}`}
      </span>{" "}
      {done && <span title="sfinalizowana">✓</span>}
      {noShow && <span title="nie przyszła">✗</span>}
      {appt.status === "confirmed" && <span title="potwierdzona">☑</span>}
      {appt.source === "online" && <span title="rezerwacja online">🌐</span>}{" "}
      <span className={`font-medium ${noShow ? "line-through" : ""}`}>{clientName(appt.client)}</span>
      {dur >= 30 && <span className="block truncate text-[11px] opacity-80">{names}</span>}
      {subtitle && dur >= 45 && <span className="block truncate text-[11px] opacity-80">👤 {subtitle}</span>}
      {dur >= 45 && tags.length > 0 && (
        <span className="mt-0.5 flex gap-1">
          {tags.map((t) => (
            <span key={t!.id} className="rounded px-1 text-[10px] text-white" style={{ background: t!.color }}>{t!.name}</span>
          ))}
        </span>
      )}
      </span>
    </button>
  );
}
