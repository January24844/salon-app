"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal, { ErrorBox, errText } from "@/components/Modal";
import type { Category, Room, Service } from "@/lib/types";
import { norm } from "@/lib/types";

const PALETTE = ["#F7C59F", "#7FD8C6", "#D7B8F3", "#B8C4D6", "#F4A7B9", "#C5E0A5", "#A8D4F5", "#FFE89A"];

export default function RoomManager({
  rooms,
  services,
  categories,
  links,
}: {
  rooms: Room[];
  services: Service[];
  categories: Category[];
  links: { service_id: string; room_id: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Room | "new" | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Gabinety i urządzenia</h2>
          <p className="text-sm text-muted">Osobne kolumny w kalendarzu. Jedno urządzenie nie może być zajęte przez dwie wizyty naraz.</p>
        </div>
        <button className="btn-primary whitespace-nowrap" onClick={() => setEditing("new")}>+ Dodaj</button>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {rooms.map((r) => (
          <li key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.active ? "" : "opacity-50"}`}>
            <span className="size-5 shrink-0 rounded-md" style={{ background: r.color }} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.name} {!r.active && <span className="text-xs text-muted">(ukryty)</span>}</p>
              <p className="text-xs text-muted">
                {r.open_time.slice(0, 5)} – {r.close_time.slice(0, 5)} · {links.filter((l) => l.room_id === r.id).length} zabiegów
                przypisanych
              </p>
            </div>
            <button className="btn-secondary" onClick={() => setEditing(r)}>Edytuj</button>
          </li>
        ))}
        {rooms.length === 0 && <li className="px-4 py-6 text-center text-muted">Brak gabinetów.</li>}
      </ul>

      {editing && (
        <RoomForm
          room={editing === "new" ? null : editing}
          services={services}
          categories={categories}
          links={links}
          nextOrder={rooms.length + 1}
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

function RoomForm({
  room,
  services,
  categories,
  links,
  nextOrder,
  onClose,
  onSaved,
}: {
  room: Room | null;
  services: Service[];
  categories: Category[];
  links: { service_id: string; room_id: string }[];
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(room?.name ?? "");
  const [color, setColor] = useState(room?.color ?? PALETTE[nextOrder % PALETTE.length]);
  const [open, setOpen] = useState(room?.open_time.slice(0, 5) ?? "10:00");
  const [close, setClose] = useState(room?.close_time.slice(0, 5) ?? "21:00");
  const [active, setActive] = useState(room?.active ?? true);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(room ? links.filter((l) => l.room_id === room.id).map((l) => l.service_id) : []),
  );
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = services.filter((s) => words.every((w) => norm(s.name).includes(w)));

  async function save() {
    if (!name.trim()) return setError("Wpisz nazwę.");
    if (close <= open) return setError("Godzina zamknięcia musi być późniejsza niż otwarcia.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const row = { name: name.trim(), color, open_time: open, close_time: close, active };
    let id = room?.id;
    if (id) {
      const { error } = await supabase.from("rooms").update(row).eq("id", id);
      if (error) return fail(error);
    } else {
      const { data, error } = await supabase.from("rooms").insert({ ...row, sort_order: nextOrder }).select("id").single();
      if (error) return fail(error);
      id = data.id as string;
    }
    const del = await supabase.from("service_rooms").delete().eq("room_id", id);
    if (del.error) return fail(del.error);
    if (chosen.size) {
      const ins = await supabase.from("service_rooms").insert([...chosen].map((service_id) => ({ service_id, room_id: id })));
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
      title={room ? `Edycja: ${room.name}` : "Nowy gabinet / urządzenie"}
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
          <label className="label" htmlFor="rm-name">Nazwa</label>
          <input id="rm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Laser, pokój zabiegowy" />
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0 mr-2">Godziny</span>
          <input type="time" step={900} className="input w-28" value={open} onChange={(e) => setOpen(e.target.value)} aria-label="Otwarcie" />
          –
          <input type="time" step={900} className="input w-28" value={close} onChange={(e) => setClose(e.target.value)} aria-label="Zamknięcie" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Widoczny w kalendarzu
        </label>
        <div>
          <span className="label">Zabiegi wykonywane w tym gabinecie / na tym urządzeniu ({chosen.size})</span>
          <p className="mb-2 text-xs text-muted">Przy umawianiu takiego zabiegu gabinet podpowie się sam.</p>
          <input className="input mb-2" placeholder="szukaj zabiegu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj zabiegu" />
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-border px-3 py-2">
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
                  <span className="flex-1">{s.name}</span>
                  <span className="text-xs text-muted">{s.category_id ? catName.get(s.category_id) : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
