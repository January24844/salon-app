// Wszystkie godziny w aplikacji liczymy w czasie polskim, niezależnie od tego,
// gdzie stoi serwer (Vercel działa w UTC).
export const TZ = "Europe/Warsaw";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    h: +p.hour,
    min: +p.minute,
    s: +p.second,
  };
}

/** Przesunięcie strefy (w minutach) dla danej chwili, np. 60 zimą, 120 latem. */
function offsetMinutes(utcMs: number) {
  const w = wallParts(new Date(utcMs));
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return Math.round((asUtc - utcMs) / 60000);
}

/** "2026-10-29" + "10:20" (czas polski) → Date */
export function zonedToUtc(date: string, time = "00:00"): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - offsetMinutes(guess) * 60000;
  utc = guess - offsetMinutes(utc) * 60000; // poprawka przy zmianie czasu
  return new Date(utc);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → { date: "2026-10-29", time: "10:20", minutes: 620 } w czasie polskim */
export function toZoned(input: Date | string) {
  const w = wallParts(typeof input === "string" ? new Date(input) : input);
  return {
    date: `${w.y}-${pad(w.m)}-${pad(w.d)}`,
    time: `${pad(w.h)}:${pad(w.min)}`,
    minutes: w.h * 60 + w.min,
  };
}

export function todayStr() {
  return toZoned(new Date()).date;
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 1 = poniedziałek … 7 = niedziela */
export function weekday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function isoWeek(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function isValidDate(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export const timeToMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
export const minToTime = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

export function formatDayLong(date: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}

export function formatDayShort(date: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}

export function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(n ?? 0));

/** Bieżący czas (w osobnej funkcji, żeby komponenty serwera pozostały „czyste”). */
export const nowMs = () => Date.now();

/** Odmiana: plural(1, "wizyta", "wizyty", "wizyt") */
export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
