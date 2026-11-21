import Link from "next/link";
import type { Room, Staff } from "@/lib/types";

const dmy = (d: string) => d.split("-").reverse().join(".");

/** Lewy panel jak w Versum: pracownicy z datą "grafik do", zasoby (gabinety). */
export default function ScheduleSidebar({
  staff,
  until,
  rooms,
  activeId,
}: {
  staff: Staff[];
  until: Record<string, string>;
  rooms: Room[];
  activeId?: string;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-card p-4 lg:block print:hidden">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Grafiki pracowników</h2>
      <Link
        href="/panel/grafik"
        className={`block rounded-md px-2 py-1.5 text-sm ${!activeId ? "bg-accent-soft font-medium" : "hover:bg-accent-soft"}`}
      >
        Wszyscy pracownicy
      </Link>
      <ul className="mt-1 space-y-0.5 border-l border-border pl-2">
        {staff.map((s) => (
          <li key={s.id}>
            <Link
              href={`/panel/grafik/${s.id}`}
              className={`block rounded-md px-2 py-1 text-sm ${activeId === s.id ? "bg-accent-soft font-medium" : "hover:bg-accent-soft"}`}
            >
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.full_name}
              </span>
              <span className="block text-[11px] text-muted">{until[s.id] ? `Grafik do ${dmy(until[s.id])}` : "brak grafiku"}</span>
            </Link>
          </li>
        ))}
      </ul>
      {rooms.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Grafiki zasobów</h2>
          <ul className="space-y-1 border-l border-border pl-2">
            {rooms.map((r) => (
              <li key={r.id} className="px-2 py-0.5 text-sm">
                {r.name}
                <span className="block text-[11px] text-amber-700 dark:text-amber-300">
                  Dostępny {r.open_time.slice(0, 5)}–{r.close_time.slice(0, 5)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
