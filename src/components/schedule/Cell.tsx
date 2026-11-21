import type { ResolvedDay } from "@/components/calendar/schedule";

export const hoursFmt = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
};

const ICON: Record<string, string> = {
  off: "⊘",
  vacation: "☀",
  sick: "✚",
  holiday: "⚑",
  closed: "🔒",
  none: "",
};

/** Komórka grafiku – wygląd jak w Versum (kolor pracownicy, godziny, liczba godzin). */
export default function ScheduleCell({
  day,
  color,
  onClick,
  highlight,
}: {
  day: ResolvedDay;
  color: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const work = day.kind === "work";
  const fromWeekly = day.source === "weekly";
  return (
    <button
      type="button"
      onClick={onClick}
      title={fromWeekly ? "ze stałego grafiku tygodniowego – kliknij, aby zmienić ten dzień" : "kliknij, aby zmienić"}
      className={`block h-full min-h-12 w-full rounded-md border px-2 py-1 text-left text-xs leading-snug transition hover:brightness-95 ${
        highlight ? "ring-2 ring-accent/50" : ""
      } ${fromWeekly ? "border-dashed" : ""}`}
      style={{
        borderColor: work ? color : `color-mix(in srgb, ${color} 45%, var(--border))`,
        borderTopWidth: work ? 3 : 1,
        background: work
          ? `color-mix(in srgb, ${color} 18%, var(--card))`
          : day.kind === "none"
            ? "var(--card)"
            : `color-mix(in srgb, ${color} 10%, var(--card))`,
      }}
    >
      {work ? (
        <>
          <span className="block whitespace-nowrap font-medium tabular-nums">{day.label.replaceAll(" - ", "–")}</span>
          <span className="block font-semibold">{hoursFmt(day.minutes)}</span>
        </>
      ) : day.kind === "none" ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="flex items-start gap-1 text-muted">
          <span aria-hidden>{ICON[day.kind]}</span>
          <span className="first-letter:uppercase">{day.label}</span>
        </span>
      )}
    </button>
  );
}
