"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type {
  Appointment,
  Category,
  ClientLite,
  Label,
  PaymentMethod,
  Room,
  ScheduleDay,
  Service,
  Staff,
  WorkingHours,
} from "@/lib/types";
import { clientName, norm } from "@/lib/types";
import { addDays, formatMinutes, minToTime, money, timeToMin, toZoned, zonedToUtc } from "@/lib/time";
import { freeSlots, workIntervals, type Interval } from "./schedule";

export type FormInit = { staffId: string; roomId?: string | null; date: string; time: string; appointment?: Appointment };

type Line = { service_id: string; name: string; duration_minutes: number; price: number };

export default function AppointmentForm({
  init,
  staff,
  services,
  categories,
  labels,
  methods,
  hours,
  rooms,
  serviceRooms,
  calendarRange,
  onClose,
  onSaved,
}: {
  init: FormInit;
  staff: Staff[];
  services: Service[];
  categories: Category[];
  labels: Label[];
  methods: PaymentMethod[];
  hours: WorkingHours[];
  rooms: Room[];
  serviceRooms: { service_id: string; room_id: string }[];
  calendarRange: Interval;
  onClose: () => void;
  onSaved: () => void;
}) {
  const a = init.appointment;
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [staffId, setStaffId] = useState(init.staffId);
  const [roomId, setRoomId] = useState<string>(init.roomId ?? "");
  const [client, setClient] = useState<ClientLite | null>(a?.client ?? null);
  const [newClient, setNewClient] = useState<{ first_name: string; last_name: string; phone: string; email: string } | null>(null);
  const [lines, setLines] = useState<Line[]>(
    a
      ? [...a.appointment_services]
          .sort((x, y) => x.position - y.position)
          .map((s) => ({
            service_id: s.service_id,
            name: s.service?.name ?? "",
            duration_minutes: s.duration_minutes,
            price: Number(s.price),
          }))
      : [],
  );
  const [customDuration, setCustomDuration] = useState<number | null>(() => {
    if (!a) return null;
    const total = a.appointment_services.reduce((n, s) => n + s.duration_minutes, 0);
    const real = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60000);
    return real !== total ? real : null;
  });
  const [note, setNote] = useState(a?.staff_note ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(a?.appointment_labels.map((l) => l.label_id) ?? []);
  const [deposit, setDeposit] = useState<string>(a?.deposit_amount ? String(a.deposit_amount) : "");
  const [depositMethod, setDepositMethod] = useState(a?.deposit_method ?? "blik");
  const [showDeposit, setShowDeposit] = useState(!!a?.deposit_amount);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const servicesTotal = lines.reduce((n, l) => n + l.duration_minutes, 0);
  const duration = customDuration ?? (servicesTotal || 15);
  const price = lines.reduce((n, l) => n + Number(l.price || 0), 0);
  const endTime = minToTime(Math.min(timeToMin(time || "00:00") + duration, 24 * 60 - 1));

  async function save() {
    setError(null);
    if (!lines.length) return setError("Wybierz co najmniej jedną usługę.");
    if (!client && !newClient?.first_name.trim()) return setError("Wybierz klientkę albo dodaj nową.");
    setBusy(true);
    const start = zonedToUtc(date, time);
    const payload = {
      id: a?.id ?? null,
      client_id: client?.id ?? null,
      new_client: client ? null : newClient,
      staff_id: staffId,
      room_id: roomId || null,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + duration * 60000).toISOString(),
      services: lines.map((l) => ({ service_id: l.service_id, duration_minutes: l.duration_minutes, price: l.price })),
      labels: labelIds,
      note,
      deposit: showDeposit && Number(deposit) > 0 ? { amount: Number(deposit), method: depositMethod } : null,
    };
    const { error } = await createClient().rpc("save_appointment", { p: payload });
    setBusy(false);
    if (error) return setError(errText(error));
    onSaved();
  }

  return (
    <Modal
      wide
      title={a ? "Edycja wizyty" : "Nowa wizyta"}
      onClose={onClose}
      footer={
        <>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? "Zapisywanie…" : a ? "Zapisz zmiany" : "Dodaj wizytę"}
          </button>
          <button onClick={onClose} className="btn-ghost">Anuluj</button>
          <span className="ml-auto text-sm text-muted">
            {formatMinutes(duration)} · <strong className="text-foreground">{money(price)}</strong>
          </span>
        </>
      }
    >
      <div className="space-y-5">
        {/* --- termin --- */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="f-date">Dzień</label>
            <input id="f-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-time">Początek</label>
            <input id="f-time" type="time" step={300} className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="f-dur">Koniec</label>
            <div className="flex items-center gap-2">
              <input
                id="f-dur"
                type="time"
                step={300}
                className="input"
                value={endTime}
                onChange={(e) => {
                  const d = timeToMin(e.target.value) - timeToMin(time);
                  if (d > 0) setCustomDuration(d === servicesTotal ? null : d);
                }}
              />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="f-staff">Pracownica</label>
            <select id="f-staff" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="f-room">Gabinet</label>
            <select id="f-room" className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">— brak —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </section>
        {customDuration !== null && (
          <p className="-mt-3 text-xs text-muted">
            Czas zmieniony ręcznie ({formatMinutes(customDuration)}).{" "}
            <button className="underline" onClick={() => setCustomDuration(null)}>Wróć do czasu z usług</button>
          </p>
        )}

        {/* --- klientka --- */}
        <section>
          <span className="label">Klientka</span>
          <ClientPicker
            client={client}
            newClient={newClient}
            onPick={(c) => {
              setClient(c);
              setNewClient(null);
            }}
            onNew={(q) => {
              setClient(null);
              const [first, ...rest] = q.trim().split(/\s+/);
              const isPhone = /^[+\d\s-]{6,}$/.test(q.trim());
              setNewClient({
                first_name: isPhone ? "" : first ?? "",
                last_name: isPhone ? "" : rest.join(" "),
                phone: isPhone ? q.trim() : "",
                email: "",
              });
            }}
            setNewClient={setNewClient}
          />
        </section>

        {/* --- usługi --- */}
        <section>
          <span className="label">Usługi</span>
          <ServicePicker
            services={services}
            categories={categories}
            onAdd={(s) => {
              setLines((ls) => [
                ...ls,
                { service_id: s.id, name: s.name, duration_minutes: s.duration_minutes, price: Number(s.price) },
              ]);
              // zabieg wymaga gabinetu/urządzenia → podpowiedz go
              const needed = serviceRooms.find((x) => x.service_id === s.id);
              if (!roomId && needed) setRoomId(needed.room_id);
            }}
          />
          {lines.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {lines.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{l.name}</span>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="number"
                      min={5}
                      step={5}
                      value={l.duration_minutes}
                      onChange={(e) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, duration_minutes: Math.max(5, +e.target.value) } : x)))
                      }
                      className="input w-16 px-2 py-1"
                      aria-label="Czas w minutach"
                    />
                    min
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={l.price}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)))}
                      className="input w-20 px-2 py-1"
                      aria-label="Cena"
                    />
                    zł
                  </label>
                  <button
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    className="btn-ghost px-2 py-1"
                    aria-label="Usuń usługę"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- wolne godziny --- */}
        {lines.length > 0 && (
          <FreeTimes
            date={date}
            staffId={staffId}
            room={rooms.find((r) => r.id === roomId) ?? null}
            duration={duration}
            hours={hours}
            fallback={calendarRange}
            excludeId={a?.id}
            selected={time}
            onPick={(t) => setTime(t)}
          />
        )}

        {/* --- opis --- */}
        <section>
          <label className="label" htmlFor="f-note">Opis</label>
          <textarea id="f-note" rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </section>

        {/* --- etykiety --- */}
        {labels.length > 0 && (
          <section>
            <span className="label">Etykiety</span>
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => setLabelIds((ids) => (on ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
                    className={`rounded-full border px-3 py-1 text-xs transition ${on ? "text-white" : "border-border text-muted"}`}
                    style={on ? { background: l.color, borderColor: l.color } : undefined}
                    aria-pressed={on}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* --- przedpłata --- */}
        <section>
          <span className="label">Przedpłata</span>
          {!showDeposit ? (
            <p className="text-sm">
              brak przedpłaty{" "}
              <button className="text-accent underline-offset-2 hover:underline" onClick={() => setShowDeposit(true)}>+ dodaj</button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step={10}
                placeholder="kwota"
                className="input w-28"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                aria-label="Kwota przedpłaty"
              />
              <span className="text-sm text-muted">zł</span>
              <select className="input w-auto" value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)} aria-label="Sposób zapłaty">
                {methods
                  .filter((m) => ["gotowka", "karta", "blik", "przelew"].includes(m.code))
                  .map((m) => (
                    <option key={m.code} value={m.code}>{m.name}</option>
                  ))}
              </select>
              <button
                className="btn-ghost text-sm"
                onClick={() => {
                  setShowDeposit(false);
                  setDeposit("");
                }}
              >
                usuń
              </button>
            </div>
          )}
        </section>

        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function ClientPicker({
  client,
  newClient,
  onPick,
  onNew,
  setNewClient,
}: {
  client: ClientLite | null;
  newClient: { first_name: string; last_name: string; phone: string; email: string } | null;
  onPick: (c: ClientLite | null) => void;
  onNew: (q: string) => void;
  setNewClient: (c: { first_name: string; last_name: string; phone: string; email: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientLite[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const words = q.replace(/[,()%*]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (!words.length || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const w = words[0];
      const { data } = await createClient()
        .from("clients")
        .select("id, first_name, last_name, phone, email")
        .or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,phone.ilike.%${w.replace(/\s/g, "")}%,email.ilike.%${w}%`)
        .order("last_name")
        .limit(20);
      const list = ((data ?? []) as ClientLite[]).filter((c) => {
        const hay = norm([c.first_name, c.last_name, c.phone, c.email].filter(Boolean).join(" "));
        return words.every((x) => hay.includes(norm(x)));
      });
      setResults(list.slice(0, 8));
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (client)
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{clientName(client)}</p>
          <p className="text-xs text-muted">{[client.phone, client.email].filter(Boolean).join(" · ") || "brak kontaktu"}</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => onPick(null)}>zmień</button>
      </div>
    );

  if (newClient)
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Nowa klientka</p>
          <button className="btn-ghost text-sm" onClick={() => setNewClient(null)}>wyszukaj istniejącą</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["first_name", "Imię *"],
              ["last_name", "Nazwisko"],
              ["phone", "Telefon"],
              ["email", "E-mail"],
            ] as const
          ).map(([k, ph]) => (
            <input
              key={k}
              className="input"
              placeholder={ph}
              aria-label={ph}
              type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
              value={newClient[k]}
              onChange={(e) => setNewClient({ ...newClient, [k]: e.target.value })}
            />
          ))}
        </div>
      </div>
    );

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="wpisz nazwisko lub numer telefonu"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) {
              setResults([]);
              setOpen(false);
            }
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Szukaj klientki"
        />
        <button className="btn-secondary whitespace-nowrap" onClick={() => onNew(q)}>nowa klientka</button>
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent-soft"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(c)}
              >
                <span className="font-medium">{clientName(c)}</span>
                <span className="ml-2 text-muted">{c.phone}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              Brak wyników.{" "}
              <button className="text-accent underline" onMouseDown={(e) => e.preventDefault()} onClick={() => onNew(q)}>
                Dodaj „{q.trim()}” jako nową klientkę
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ServicePicker({
  services,
  categories,
  onAdd,
}: {
  services: Service[];
  categories: Category[];
  onAdd: (s: Service) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const topCats = categories.filter((c) => !c.parent_id);
  const childIds = (id: string) => [id, ...categories.filter((c) => c.parent_id === id).map((c) => c.id)];

  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const allowed = catId ? new Set(childIds(catId)) : null;
    return services
      .filter((s) => s.active)
      .filter((s) => !allowed || (s.category_id && allowed.has(s.category_id)))
      .filter((s) => words.every((w) => norm(s.name).includes(w)))
      // najpierw nazwy zaczynające się od wpisanego tekstu
      .sort((a, b) => Number(!norm(a.name).startsWith(words[0] ?? "")) - Number(!norm(b.name).startsWith(words[0] ?? "")))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, catId, services]);

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="input"
          placeholder="wpisz nazwę lub wybierz z listy"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Szukaj usługi"
        />
        <select
          className="input w-40 shrink-0"
          value={catId}
          onChange={(e) => {
            setCatId(e.target.value);
            setOpen(true);
            inputRef.current?.focus();
          }}
          aria-label="Kategoria"
        >
          <option value="">wszystkie</option>
          {topCats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {list.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAdd(s);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  {s.name}
                  <span className="block text-xs text-muted">{s.category_id ? catName.get(s.category_id) : ""}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-muted">{s.duration_minutes} min</span>
                <span className="whitespace-nowrap font-medium">{money(s.price)}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nie znaleziono usługi.</li>}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FreeTimes({
  date,
  staffId,
  room,
  duration,
  hours,
  fallback,
  excludeId,
  selected,
  onPick,
}: {
  date: string;
  staffId: string;
  room: Room | null;
  duration: number;
  hours: WorkingHours[];
  fallback: Interval;
  excludeId?: string;
  selected: string;
  onPick: (t: string) => void;
}) {
  const [data, setData] = useState<{ key: string; busy: Interval[]; schedule: ScheduleDay[] } | null>(null);
  const key = `${date}|${staffId}|${room?.id ?? ""}`;

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const from = zonedToUtc(date).toISOString();
      const to = zonedToUtc(addDays(date, 1)).toISOString();
      let q = supabase
        .from("appointments")
        .select("id, starts_at, ends_at");
      q = room ? q.or(`staff_id.eq.${staffId},room_id.eq.${room.id}`) : q.eq("staff_id", staffId);
      const [appts, sched] = await Promise.all([
        q
          .in("status", ["booked", "confirmed", "completed"])
          .gte("starts_at", from)
          .lt("starts_at", to),
        supabase.from("staff_schedule_days").select("*").eq("staff_id", staffId).eq("day", date),
      ]);
      if (cancelled) return;
      const busy = ((appts.data ?? []) as { id: string; starts_at: string; ends_at: string }[])
        .filter((x) => x.id !== excludeId)
        .map((x) => [toZoned(x.starts_at).minutes, toZoned(x.ends_at).minutes] as Interval);
      setData({ key, busy, schedule: (sched.data ?? []) as ScheduleDay[] });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, date, staffId, room, excludeId]);

  if (!data || data.key !== key) return <p className="text-xs text-muted">Sprawdzam wolne godziny…</p>;
  const work = workIntervals(staffId, date, hours, data.schedule, fallback);
  // gdy wybrany gabinet – tylko godziny, w których jest też otwarty
  const roomOpen: Interval | null = room ? [timeToMin(room.open_time), timeToMin(room.close_time)] : null;
  const intervals = roomOpen
    ? work.intervals
        .map(([a, b]) => [Math.max(a, roomOpen[0]), Math.min(b, roomOpen[1])] as Interval)
        .filter(([a, b]) => b > a)
    : work.intervals;
  const slots = freeSlots(intervals, data.busy, duration);

  return (
    <section>
      <span className="label">
        Wolne godziny tego dnia {work.label && <span className="normal-case">({work.label}{room ? `, ${room.name}` : ""})</span>}
      </span>
      {slots.length === 0 ? (
        <p className="text-sm text-muted">
          {work.intervals.length === 0 ? "Pracownica ma tego dnia wolne." : "Brak wolnego miejsca na tak długą wizytę."} Godzinę
          możesz wpisać ręcznie powyżej.
        </p>
      ) : (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {slots.map((m) => {
            const t = minToTime(m);
            return (
              <button
                key={m}
                onClick={() => onPick(t)}
                className={`rounded-md border px-2 py-1 text-xs tabular-nums ${
                  t === selected ? "border-accent bg-accent text-white" : "border-border hover:bg-accent-soft"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
