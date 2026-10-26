import CalendarView from "@/components/calendar/CalendarView";
import { requireTeam } from "@/lib/auth";
import { addDays, isValidDate, todayStr, zonedToUtc } from "@/lib/time";
import {
  APPOINTMENT_SELECT,
  type Appointment,
  type Category,
  type DayNote,
  type Label,
  type PaymentMethod,
  type Room,
  type ScheduleDay,
  type Service,
  type Staff,
  type WorkingHours,
} from "@/lib/types";

export default async function CalendarPage({ searchParams }: PageProps<"/panel">) {
  const sp = await searchParams;
  const date = isValidDate(sp.d as string) ? (sp.d as string) : todayStr();
  const { supabase, role } = await requireTeam();

  const from = zonedToUtc(date).toISOString();
  const to = zonedToUtc(addDays(date, 1)).toISOString();

  const [staff, hours, schedule, appts, services, cats, labels, methods, notes, settings, rooms, serviceRooms] = await Promise.all([
    supabase.from("staff").select("*").eq("active", true).order("sort_order").order("full_name"),
    supabase.from("staff_working_hours").select("staff_id, weekday, start_time, end_time"),
    supabase.from("staff_schedule_days").select("*").eq("day", date),
    supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .neq("status", "cancelled")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at"),
    supabase
      .from("services")
      .select("id, name, category_id, duration_minutes, price, package_sessions, active, sort_order")
      .eq("active", true)
      .order("sort_order"),
    supabase.from("service_categories").select("*").order("sort_order"),
    supabase.from("labels").select("*").order("name"),
    supabase.from("payment_methods").select("*").eq("active", true).order("sort_order"),
    supabase.from("calendar_day_notes").select("*").eq("day", date).order("created_at"),
    supabase.from("salon_settings").select("calendar_start, calendar_end").maybeSingle(),
    supabase.from("rooms").select("*").eq("active", true).order("sort_order").order("name"),
    supabase.from("service_rooms").select("service_id, room_id"),
  ]);

  const firstError = [staff, hours, schedule, appts, services, cats, labels, methods, notes, rooms].find((r) => r.error)?.error;
  if (firstError) {
    return (
      <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Nie udało się wczytać kalendarza: {firstError.message}. Sprawdź, czy w Supabase uruchomiono pliki
        <code className="mx-1">003_panel.sql</code> i <code className="mx-1">005_gabinety.sql</code>.
      </div>
    );
  }

  return (
    <CalendarView
      key={date}
      date={date}
      staff={(staff.data ?? []) as Staff[]}
      hours={(hours.data ?? []) as WorkingHours[]}
      schedule={(schedule.data ?? []) as ScheduleDay[]}
      appointments={(appts.data ?? []) as unknown as Appointment[]}
      services={(services.data ?? []) as Service[]}
      categories={(cats.data ?? []) as Category[]}
      labels={(labels.data ?? []) as Label[]}
      methods={(methods.data ?? []) as PaymentMethod[]}
      notes={(notes.data ?? []) as DayNote[]}
      rooms={(rooms.data ?? []) as Room[]}
      serviceRooms={serviceRooms.data ?? []}
      calendarStart={settings.data?.calendar_start ?? "08:00"}
      calendarEnd={settings.data?.calendar_end ?? "21:00"}
      isOwner={role === "owner"}
    />
  );
}
