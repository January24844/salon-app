import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

/** Zalogowana osoba z zespołu – inaczej przekierowanie do logowania. */
export async function requireTeam() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/logowanie");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  const role = (profile?.role ?? "client") as Role;
  return { supabase, user: data.user, role, fullName: profile?.full_name as string | null };
}
