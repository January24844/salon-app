import ServiceManager from "@/components/ServiceManager";
import { requireTeam } from "@/lib/auth";
import type { Category, Service } from "@/lib/types";

export default async function ServicesPage() {
  const { supabase, role } = await requireTeam();
  const [services, cats] = await Promise.all([
    supabase.from("services").select("id, name, category_id, duration_minutes, price, package_sessions, active, sort_order").order("sort_order"),
    supabase.from("service_categories").select("*").order("sort_order"),
  ]);
  return (
    <ServiceManager
      services={(services.data ?? []) as Service[]}
      categories={(cats.data ?? []) as Category[]}
      canEdit={role === "owner"}
    />
  );
}
