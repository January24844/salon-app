import { notFound } from "next/navigation";
import ScheduleSidebar from "@/components/schedule/Sidebar";
import StaffMonthView from "@/components/schedule/StaffMonthView";
import { requireTeam } from "@/lib/auth";
import { loadScheduleData } from "@/lib/schedule-data";
import { addDays, todayStr, weekday } from "@/lib/time";
import type { ScheduleTemplate, Staff } from "@/lib/types";

export default async function StaffSchedulePage({ params, searchParams }: PageProps<"/panel/grafik/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : todayStr().slice(0, 7);
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const from = addDays(first, 1 - weekday(first));
  const to = addDays(last, 7 - weekday(last));

  const { supabase } = await requireTeam();
  const [data, staffRow, templates] = await Promise.all([
    loadScheduleData(supabase, from, to, id),
    supabase.from("staff").select("*").eq("id", id).maybeSingle(),
    supabase.from("schedule_templates").select("*, schedule_template_days(*)").eq("staff_id", id).order("created_at"),
  ]);
  if (!staffRow.data) notFound();

  return (
    <div className="flex flex-1">
      <ScheduleSidebar staff={data.staff} until={data.until} rooms={data.rooms} activeId={id} />
      {data.error || templates.error ? (
        <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Nie udało się wczytać grafiku: {(data.error ?? templates.error)?.message}. Sprawdź, czy w Supabase uruchomiono plik
          <code className="mx-1">016_grafik.sql</code>.
        </div>
      ) : (
        <StaffMonthView
          staff={staffRow.data as Staff}
          month={month}
          hours={data.hours}
          schedule={data.schedule}
          closedWeekdays={data.closedWeekdays}
          templates={(templates.data ?? []) as ScheduleTemplate[]}
        />
      )}
    </div>
  );
}
