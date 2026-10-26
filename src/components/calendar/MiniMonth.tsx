"use client";

import { useState } from "react";
import Link from "next/link";
import { todayStr } from "@/lib/time";

const MONTHS = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const pad = (n: number) => String(n).padStart(2, "0");

export default function MiniMonth({ selected }: { selected: string }) {
  const [y0, m0] = selected.split("-").map(Number);
  const [view, setView] = useState({ y: y0, m: m0 }); // m: 1-12
  const today = todayStr();

  const first = new Date(Date.UTC(view.y, view.m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // poniedziałek = 0
  const start = Date.UTC(view.y, view.m - 1, 1 - lead);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86400000);
    return {
      str: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === view.m - 1,
    };
  });

  const shift = (n: number) =>
    setView((v) => {
      const t = new Date(Date.UTC(v.y, v.m - 1 + n, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    });

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button className="btn-ghost px-2 py-1" onClick={() => shift(-1)} aria-label="Poprzedni miesiąc">‹</button>
        <span className="text-sm font-medium uppercase tracking-wide">
          {MONTHS[view.m - 1]} {view.y}
        </span>
        <button className="btn-ghost px-2 py-1" onClick={() => shift(1)} aria-label="Następny miesiąc">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {["pn", "wt", "śr", "cz", "pt", "so", "n"].map((d) => (
          <span key={d} className="py-1 text-muted">{d}</span>
        ))}
        {days.map((d) => (
          <Link
            key={d.str}
            href={`/panel?d=${d.str}`}
            scroll={false}
            className={`m-px rounded-md py-1.5 tabular-nums transition hover:bg-accent-soft ${
              d.str === selected
                ? "bg-accent font-medium text-white hover:bg-accent"
                : d.str === today
                  ? "font-semibold text-accent ring-1 ring-accent"
                  : d.inMonth
                    ? ""
                    : "text-muted/60"
            }`}
          >
            {d.day}
          </Link>
        ))}
      </div>
    </div>
  );
}
