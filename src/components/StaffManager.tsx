"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type { Category, Service, Staff, WorkingHours } from "@/lib/types";

const PALETTE = ["#F4A7B9", "#C5E0A5", "#A8D4F5", "#8DB86B", "#FFE89A", "#D7B8F3", "#F7C59F", "#9AD9D2", "#E3A6A6", "#B8C4D6"];
const DAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];

type DayRow = { on: boolean; start: string; end: string };

export default function StaffManager({
  staff,
  hours,
  services,
  categories,
  assignments,
}: {
  staff: Staff[];
  hours: WorkingHours[];
  services: Service[];
  categories: Category[];
  assignments: { staff_id: string; service_id: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  async function move(s: Staff, dir: -1 | 1) {
    const list = [...staff];
    const i = list.findIndex((x) => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const supabase = createClient();
    await Promise.all(list.map((x, k) => supabase.from("staff").update({ sort_order: k + 1 }).eq("id", x.id)));
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Pracownice</h1>
        <button className="btn-primary" onClick={() => setEditing("new")}>+ Dodaj pracownicę</button>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {staff.map((s, i) => {
          const mine = hours.filter((h) => h.staff_id === s.id);
          const count = assignments.filter((a) => a.staff_id === s.id).length;
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.active ? "" : "opacity-50"}`}>
              <span className="size-5 shrink-0 rounded-md" style={{ background: s.color }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {s.full_name} {!s.active && <span className="text-xs text-muted">(nieaktywna)</span>}
                </p>
                <p className="text-xs text-muted">
                  {mine.length ? `pracuje: ${[...new Set(mine.map((h) => DAYS[h.weekday - 1].slice(0, 3)))].join(", ")}` : "grafik nieustawiony"}
                  {" · "}
                  {count} z {services.length} zabiegów
                  {s.bookable_online ? " · rezerwacje online" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button className="btn-ghost px-2" onClick={() => move(s, -1)} disabled={i === 0} aria-label="Wyżej">↑</button>
                <button className="btn-ghost px-2" onClick={() => move(s, 1)} disabled={i === staff.length - 1} aria-label="Niżej">↓</button>
                <button className="btn-secondary" onClick={() => setEditing(s)}>Edytuj</button>
              </div>
            </li>
          );
        })}
        {staff.length === 0 && <li className="px-4 py-6 text-center text-muted">Nie ma jeszcze pracownic.</li>}
      </ul>
      <p className="mt-3 text-xs text-muted">Kolejność na liście = kolejność kolumn w kalendarzu.</p>

      {editing && (
        <StaffForm
          staff={editing === "new" ? null : editing}
          hours={hours}
          services={services}
          categories={categories}
          assignments={assignments}
          nextOrder={staff.length + 1}
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

function StaffForm({
  staff,
  hours,
  services,
  categories,
  assignments,
  nextOrder,
  onClose,
  onSaved,
}: {
  staff: Staff | null;
  hours: WorkingHours[];
  services: Service[];
  categories: Category[];
  assignments: { staff_id: string; service_id: string }[];
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(staff?.full_name ?? "");
  const [color, setColor] = useState(staff?.color ?? PALETTE[nextOrder % PALETTE.length]);
  const [phone, setPhone] = useState(staff?.phone ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [active, setActive] = useState(staff?.active ?? true);
  const [online, setOnline] = useState(staff?.bookable_online ?? true);
  const [days, setDays] = useState<DayRow[]>(() =>
    DAYS.map((_, i) => {
      const h = hours.find((x) => x.staff_id === staff?.id && x.weekday === i + 1);
      return h ? { on: true, start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) } : { on: false, start: "09:00", end: "17:00" };
    }),
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(staff ? assignments.filter((a) => a.staff_id === staff.id).map((a) => a.service_id) : services.map((s) => s.id)),
  );
  const [tab, setTab] = useState<"dane" | "grafik" | "zabiegi">("dane");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const top = categories.filter((c) => !c.parent_id);
  const inTop = (topId: string) => {
    const ids = new Set([topId, ...categories.filter((c) => c.parent_id === topId).map((c) => c.id)]);
    return services.filter((s) => s.category_id && ids.has(s.category_id));
  };

  async function save() {
    if (!name.trim()) return setError("Wpisz imię i nazwisko.");
    for (const d of days) if (d.on && d.end <= d.start) return setError("Godzina końca musi być późniejsza niż początku.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const row = { full_name: name.trim(), color, phone: phone || null, email: email || null, active, bookable_online: online };
    let id = staff?.id;
    if (id) {
      const { error } = await supabase.from("staff").update(row).eq("id", id);
      if (error) return fail(error);
    } else {
      const { data, error } = await supabase.from("staff").insert({ ...row, sort_order: nextOrder }).select("id").single();
      if (error) return fail(error);
      id = data.id as string;
    }
    const del1 = await supabase.from("staff_working_hours").delete().eq("staff_id", id);
    if (del1.error) return fail(del1.error);
    const rows = days.flatMap((d, i) => (d.on ? [{ staff_id: id, weekday: i + 1, start_time: d.start, end_time: d.end }] : []));
    if (rows.length) {
      const ins = await supabase.from("staff_working_hours").insert(rows);
      if (ins.error) return fail(ins.error);
    }
    const del2 = await supabase.from("staff_services").delete().eq("staff_id", id);
    if (del2.error) return fail(del2.error);
    if (chosen.size) {
      const ins = await supabase.from("staff_services").insert([...chosen].map((service_id) => ({ staff_id: id, service_id })));
      if (ins.error) return fail(ins.error);
    }
    onSaved();
  }
  function fail(e: unknown) {
    setBusy(false);
    setError(errText(e));
  }

  return (
    <Modal
      wide
      title={staff ? `Edycja: ${staff.full_name}` : "Nowa pracownica"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Zapisywanie…" : "Zapisz"}</button>
          <button className="btn-ghost" onClick={onClose}>Anuluj</button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 border-b border-border">
        {(["dane", "grafik", "zabiegi"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? "border-accent font-medium" : "border-transparent text-muted"}`}
          >
            {t === "grafik" ? "stały grafik" : t}
          </button>
        ))}
      </div>

      {tab === "dane" && (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="st-name">Imię i nazwisko</label>
            <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <span className="label">Kolor w kalendarzu</span>
            <div className="flex flex-wrap items-center gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`size-8 rounded-md ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""}`}
                  style={{ background: c }}
                  aria-label={`Kolor ${c}`}
                />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded" aria-label="Własny kolor" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st-phone">Telefon</label>
              <input id="st-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-email">E-mail</label>
              <input id="st-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktywna (widoczna w kalendarzu)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
            Klientki mogą umawiać się do niej online
          </label>
        </div>
      )}

      {tab === "grafik" && (
        <div>
          <p className="mb-3 text-sm text-muted">
            Stałe godziny pracy w tygodniu. Wyjątki (urlop, inna zmiana) ustawisz w kalendarzu, klikając imię pracownicy.
          </p>
          <ul className="space-y-2">
            {DAYS.map((d, i) => (
              <li key={d} className="flex flex-wrap items-center gap-2">
                <label className="flex w-36 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={days[i].on}
                    onChange={(e) => setDays((ds) => ds.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                  />
                  {d}
                </label>
                {days[i].on ? (
                  <>
                    <input type="time" step={900} className="input w-28" value={days[i].start} aria-label={`${d} od`}
                      onChange={(e) => setDays((ds) => ds.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                    –
                    <input type="time" step={900} className="input w-28" value={days[i].end} aria-label={`${d} do`}
                      onChange={(e) => setDays((ds) => ds.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                  </>
                ) : (
                  <span className="text-sm text-muted">wolne</span>
                )}
              </li>
            ))}
          </ul>
          <button
            className="mt-3 text-sm text-accent hover:underline"
            onClick={() => setDays((ds) => ds.map((x, i) => (i < 5 ? { ...ds.find((y) => y.on) ?? x, on: true } : x)))}
          >
            Skopiuj godziny na pon–pt
          </button>
        </div>
      )}

      {tab === "zabiegi" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Zaznaczone zabiegi będzie można umówić u tej pracownicy.</p>
          {top.map((c) => {
            const list = inTop(c.id);
            const all = list.every((s) => chosen.has(s.id));
            return (
              <details key={c.id} className="rounded-lg border border-border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={all}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      setChosen((set) => {
                        const n = new Set(set);
                        list.forEach((s) => (all ? n.delete(s.id) : n.add(s.id)));
                        return n;
                      })
                    }
                    aria-label={`Wszystkie: ${c.name}`}
                  />
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-xs text-muted">{list.filter((s) => chosen.has(s.id)).length}/{list.length}</span>
                </summary>
                <ul className="max-h-64 overflow-y-auto border-t border-border px-3 py-2">
                  {list.map((s) => (
                    <li key={s.id}>
                      <label className="flex items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={chosen.has(s.id)}
                          onChange={() =>
                            setChosen((set) => {
                              const n = new Set(set);
                              if (n.has(s.id)) n.delete(s.id);
                              else n.add(s.id);
                              return n;
                            })
                          }
                        />
                        {s.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
