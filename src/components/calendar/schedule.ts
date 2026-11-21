import type { DayKind, ScheduleDay, WorkingHours } from "@/lib/types";
import { DAY_KIND_LABEL } from "@/lib/types";
import { timeToMin, weekday } from "@/lib/time";

export type Interval = [number, number]; // minuty od północy

export type ResolvedDay = {
  /** closed = salon nieczynny, none = brak grafiku */
  kind: DayKind | "closed" | "none";
  intervals: Interval[];
  label: string;
  minutes: number;
  /** skąd wzięty: wpis w grafiku na ten dzień, stały grafik tygodniowy, brak */
  source: "day" | "weekly" | "none";
  override: ScheduleDay | null;
};

const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const sum = (iv: Interval[]) => iv.reduce((n, [a, b]) => n + (b - a), 0);

/**
 * Jak wygląda dzień pracownicy:
 * 1) wpis w grafiku na konkretny dzień (praca / wolne / urlop / L4 / święto),
 * 2) salon nieczynny w ten dzień tygodnia,
 * 3) stały grafik tygodniowy (z ustawień pracownicy),
 * 4) brak grafiku → pracownica nie pracuje.
 */
export function resolveDay(
  staffId: string,
  date: string,
  hours: WorkingHours[],
  schedule: ScheduleDay[],
  closedWeekdays: number[] = [],
): ResolvedDay {
  const override = schedule.find((s) => s.staff_id === staffId && s.day === date) ?? null;
  if (override) {
    const kind: DayKind = override.kind ?? (override.is_day_off ? "off" : "work");
    if (kind !== "work" || !override.start_time || !override.end_time)
      return { kind: kind === "work" ? "off" : kind, intervals: [], label: DAY_KIND_LABEL[kind === "work" ? "off" : kind], minutes: 0, source: "day", override };
    const iv: Interval[] = [[timeToMin(override.start_time), timeToMin(override.end_time)]];
    return {
      kind: "work",
      intervals: iv,
      label: `${override.start_time.slice(0, 5)} - ${override.end_time.slice(0, 5)}`,
      minutes: sum(iv),
      source: "day",
      override,
    };
  }
  if (closedWeekdays.includes(weekday(date)))
    return { kind: "closed", intervals: [], label: "salon nieczynny", minutes: 0, source: "none", override: null };
  const mine = hours.filter((h) => h.staff_id === staffId);
  if (mine.length) {
    const today = mine
      .filter((h) => h.weekday === weekday(date))
      .map((h) => [timeToMin(h.start_time), timeToMin(h.end_time)] as Interval)
      .sort((a, b) => a[0] - b[0]);
    if (!today.length) return { kind: "off", intervals: [], label: "dzień wolny", minutes: 0, source: "weekly", override: null };
    return {
      kind: "work",
      intervals: today,
      label: today.map(([a, b]) => `${fmt(a)} - ${fmt(b)}`).join(", "),
      minutes: sum(today),
      source: "weekly",
      override: null,
    };
  }
  return { kind: "none", intervals: [], label: "brak grafiku", minutes: 0, source: "none", override: null };
}

/** Zgodność ze starszym kodem kalendarza. */
export function workIntervals(
  staffId: string,
  date: string,
  hours: WorkingHours[],
  schedule: ScheduleDay[],
  _fallback?: Interval,
  closedWeekdays: number[] = [],
): { intervals: Interval[]; label: string; override: ScheduleDay | null } {
  const r = resolveDay(staffId, date, hours, schedule, closedWeekdays);
  return { intervals: r.intervals, label: r.label, override: r.override };
}

/** Wolne godziny startu, w których zmieści się wizyta o danej długości. */
export function freeSlots(work: Interval[], busy: Interval[], duration: number, step = 15): number[] {
  const out: number[] = [];
  for (const [ws, we] of work) {
    for (let t = Math.ceil(ws / step) * step; t + duration <= we; t += step) {
      if (!busy.some(([bs, be]) => t < be && t + duration > bs)) out.push(t);
    }
  }
  return out;
}
