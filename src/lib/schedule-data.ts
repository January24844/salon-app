import type { SupabaseClient } from "@supabase/supabase-js";
import type { Room, ScheduleDay, Staff, WorkingHours } from "@/lib/types";

/** Wspólne dane ekranów grafiku: pracownicy, stały grafik, wpisy dzienne w okresie, zasoby, dni nieczynne. */
export async function loadScheduleData(supabase: SupabaseClient, from: string, to: string, staffId?: string) {
  let schedQ = supabase.from("staff_schedule_days").select("*").gte("day", from).lte("day", to);
  let hoursQ = supabase.from("staff_working_hours").select("staff_id, weekday, start_time, end_time");
  if (staffId) {
    schedQ = schedQ.eq("staff_id", staffId);
    hoursQ = hoursQ.eq("staff_id", staffId);
  }
  const [staff, hours, schedule, until, rooms, settings] = await Promise.all([
    supabase.from("staff").select("*").eq("active", true).order("sort_order").order("full_name"),
    hoursQ,
    schedQ,
    supabase.from("staff_schedule_until").select("staff_id, until"),
    supabase.from("rooms").select("*").eq("active", true).order("sort_order"),
    supabase.from("salon_settings").select("*").maybeSingle(),
  ]);
  const error = [staff, hours, schedule, until].find((r) => r.error)?.error ?? null;
  return {
    error,
    staff: (staff.data ?? []) as Staff[],
    hours: (hours.data ?? []) as WorkingHours[],
    schedule: (schedule.data ?? []) as ScheduleDay[],
    until: Object.fromEntries((until.data ?? []).map((u: { staff_id: string; until: string }) => [u.staff_id, u.until])) as Record<string, string>,
    rooms: (rooms.data ?? []) as Room[],
    closedWeekdays: ((settings.data?.closed_weekdays as number[] | undefined) ?? [7]).map(Number),
  };
}
