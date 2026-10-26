import type { ScheduleDay, WorkingHours } from "@/lib/types";
import { timeToMin, weekday } from "@/lib/time";

export type Interval = [number, number]; // minuty od północy

/** Godziny pracy pracownicy w danym dniu (grafik dzienny ma pierwszeństwo przed tygodniowym). */
export function workIntervals(
  staffId: string,
  date: string,
  hours: WorkingHours[],
  schedule: ScheduleDay[],
  fallback: Interval,
): { intervals: Interval[]; label: string; override: ScheduleDay | null } {
  const override = schedule.find((s) => s.staff_id === staffId && s.day === date) ?? null;
  if (override) {
    if (override.is_day_off || !override.start_time || !override.end_time)
      return { intervals: [], label: "dzień wolny", override };
    return {
      intervals: [[timeToMin(override.start_time), timeToMin(override.end_time)]],
      label: `${override.start_time.slice(0, 5)} - ${override.end_time.slice(0, 5)}`,
      override,
    };
  }
  const mine = hours.filter((h) => h.staff_id === staffId);
  if (mine.length === 0) return { intervals: [fallback], label: "", override: null }; // grafik jeszcze nieustawiony
  const today = mine
    .filter((h) => h.weekday === weekday(date))
    .map((h) => [timeToMin(h.start_time), timeToMin(h.end_time)] as Interval)
    .sort((a, b) => a[0] - b[0]);
  if (!today.length) return { intervals: [], label: "dzień wolny", override: null };
  return {
    intervals: today,
    label: today.map(([a, b]) => `${fmt(a)} - ${fmt(b)}`).join(", "),
    override: null,
  };
}

const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

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
