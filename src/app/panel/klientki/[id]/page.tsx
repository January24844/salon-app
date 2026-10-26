import Link from "next/link";
import { notFound } from "next/navigation";
import ClientCardForm from "@/components/ClientCardForm";
import { requireTeam } from "@/lib/auth";
import { STATUS_LABEL, clientName, type AppointmentStatus } from "@/lib/types";
import { formatDayShort, money, nowMs, plural, toZoned } from "@/lib/time";

export default async function ClientCard({ params }: PageProps<"/panel/klientki/[id]">) {
  const { id } = await params;
  const { supabase } = await requireTeam();
  const [{ data: c }, { data: visits }, { data: packages }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("appointments")
      .select("id, starts_at, status, price, staff_note, staff:staff(full_name, color), appointment_services(position, service:services(name))")
      .eq("client_id", id)
      .order("starts_at", { ascending: false })
      .limit(200),
    supabase.from("client_packages_status").select("*").eq("client_id", id).order("purchased_at", { ascending: false }),
  ]);
  if (!c) notFound();
  const pkgIds = [...new Set((packages ?? []).map((p) => p.service_id as string))];
  const { data: pkgServices } = pkgIds.length
    ? await supabase.from("services").select("id, name").in("id", pkgIds)
    : { data: [] as { id: string; name: string }[] };
  const pkgName = new Map((pkgServices ?? []).map((s) => [s.id, s.name]));

  type Visit = {
    id: string;
    starts_at: string;
    status: AppointmentStatus;
    price: number | null;
    staff_note: string | null;
    staff: { full_name: string; color: string } | null;
    appointment_services: { position: number; service: { name: string } | null }[];
  };
  const list = (visits ?? []) as unknown as Visit[];
  const done = list.filter((v) => v.status === "completed");
  const spent = done.reduce((n, v) => n + Number(v.price ?? 0), 0);
  const now = nowMs();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <Link href="/panel/klientki" className="text-sm text-muted hover:text-foreground">← Klientki</Link>
      <div className="mt-2 mb-6 flex flex-wrap items-end gap-x-6 gap-y-2">
        <h1 className="font-serif text-3xl">{clientName(c)}</h1>
        <p className="text-sm text-muted">
          {done.length} {plural(done.length, "wizyta", "wizyty", "wizyt")} · wydała {money(spent)} · klientka od {formatDayShort(toZoned(c.created_at).date)}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <ClientCardForm client={c} />

        <div className="space-y-6">
          {(packages ?? []).length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Karnety i pakiety</h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {(packages ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{pkgName.get(p.service_id)}</span>
                    <span className="whitespace-nowrap font-medium">zostało {p.sessions_left} z {p.sessions_total}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Historia wizyt</h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {list.map((v) => {
                const z = toZoned(v.starts_at);
                const future = Date.parse(v.starts_at) > now;
                return (
                  <li key={v.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link href={`/panel?d=${z.date}`} className="font-medium tabular-nums hover:underline">
                        {formatDayShort(z.date)} {z.time}
                      </Link>
                      {v.staff && (
                        <span className="flex items-center gap-1 text-muted">
                          <span className="size-2 rounded-full" style={{ background: v.staff.color }} />
                          {v.staff.full_name}
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${future ? "bg-accent text-white" : "bg-accent-soft"}`}>
                        {future && v.status === "booked" ? "zaplanowana" : STATUS_LABEL[v.status]}
                      </span>
                      {v.status === "completed" && <span className="ml-auto font-medium">{money(v.price)}</span>}
                    </div>
                    <p className="mt-1">
                      {[...v.appointment_services].sort((a, b) => a.position - b.position).map((s) => s.service?.name).join(", ")}
                    </p>
                    {v.staff_note && <p className="mt-1 whitespace-pre-wrap text-muted">{v.staff_note}</p>}
                  </li>
                );
              })}
              {list.length === 0 && <li className="px-4 py-6 text-center text-muted">Brak wizyt.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
