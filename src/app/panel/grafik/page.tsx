import ScheduleSidebar from "@/components/schedule/Sidebar";
import WeekView from "@/components/schedule/WeekView";
import { requireTeam } from "@/lib/auth";
import { loadScheduleData } from "@/lib/schedule-data";
import { addDays, isValidDate, todayStr, weekday } from "@/lib/time";

export default async function SchedulePage({ searchParams }: PageProps<"/panel/grafik">) {
  const sp = await searchParams;
  const d = isValidDate(sp.w as string) ? (sp.w as string) : todayStr();
  const monday = addDays(d, 1 - weekday(d));
  const { supabase, role } = await requireTeam();
  const data = await loadScheduleData(supabase, monday, addDays(monday, 6));

  return (
    <div className="flex flex-1">
      <ScheduleSidebar staff={data.staff} until={data.until} rooms={data.rooms} />
      {data.error ? (
        <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Nie udało się wczytać grafików: {data.error.message}. Sprawdź, czy w Supabase uruchomiono plik
          <code className="mx-1">016_grafik.sql</code>.
        </div>
      ) : (
        <WeekView
          monday={monday}
          staff={data.staff}
          hours={data.hours}
          schedule={data.schedule}
          closedWeekdays={data.closedWeekdays}
          isOwner={role === "owner"}
        />
      )}
    </div>
  );
}
