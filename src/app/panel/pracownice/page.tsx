import RoomManager from "@/components/RoomManager";
import StaffManager from "@/components/StaffManager";
import { requireTeam } from "@/lib/auth";
import type { Category, Room, Service, Staff, WorkingHours } from "@/lib/types";

export default async function StaffPage() {
  const { supabase } = await requireTeam();
  const [staff, hours, services, cats, ss, rooms, sr] = await Promise.all([
    supabase.from("staff").select("*").order("active", { ascending: false }).order("sort_order").order("full_name"),
    supabase.from("staff_working_hours").select("staff_id, weekday, start_time, end_time"),
    supabase.from("services").select("id, name, category_id, duration_minutes, price, package_sessions, active, sort_order").order("sort_order"),
    supabase.from("service_categories").select("*").order("sort_order"),
    supabase.from("staff_services").select("staff_id, service_id"),
    supabase.from("rooms").select("*").order("sort_order").order("name"),
    supabase.from("service_rooms").select("service_id, room_id"),
  ]);
  return (
    <>
      <StaffManager
        staff={(staff.data ?? []) as Staff[]}
        hours={(hours.data ?? []) as WorkingHours[]}
        services={(services.data ?? []) as Service[]}
        categories={(cats.data ?? []) as Category[]}
        assignments={ss.data ?? []}
      />
      <RoomManager
        rooms={(rooms.data ?? []) as Room[]}
        services={(services.data ?? []) as Service[]}
        categories={(cats.data ?? []) as Category[]}
        links={sr.data ?? []}
      />
    </>
  );
}
