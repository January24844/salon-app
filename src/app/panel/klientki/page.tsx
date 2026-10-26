import Link from "next/link";
import NewClientButton from "@/components/NewClientButton";
import { requireTeam } from "@/lib/auth";
import { clientName } from "@/lib/types";

const PAGE = 50;

export default async function ClientsPage({ searchParams }: PageProps<"/panel/klientki">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.s) || 1);
  const { supabase } = await requireTeam();

  let query = supabase
    .from("clients")
    .select("id, first_name, last_name, phone, email, created_at", { count: "exact" })
    .order("last_name", { nullsFirst: false })
    .order("first_name")
    .range((page - 1) * PAGE, page * PAGE - 1);
  const words = q.replace(/[,()%*]/g, " ").split(/\s+/).filter(Boolean);
  for (const w of words) {
    query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,phone.ilike.%${w}%,email.ilike.%${w}%`);
  }
  const { data, count, error } = await query;
  const total = count ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 font-serif text-3xl">Klientki</h1>
        <form className="flex gap-2" action="/panel/klientki">
          <input name="q" defaultValue={q} className="input w-64" placeholder="nazwisko, telefon, e-mail" aria-label="Szukaj klientki" />
          <button className="btn-secondary">Szukaj</button>
        </form>
        <NewClientButton />
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            <Link href={`/panel/klientki/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent-soft">
              <span className="min-w-40 flex-1 font-medium">{clientName(c)}</span>
              <span className="text-sm text-muted tabular-nums">{c.phone}</span>
              <span className="w-56 truncate text-sm text-muted">{c.email}</span>
            </Link>
          </li>
        ))}
        {data?.length === 0 && (
          <li className="px-4 py-8 text-center text-muted">{q ? "Nic nie znaleziono." : "Nie ma jeszcze klientek."}</li>
        )}
      </ul>
      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">
            {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} z {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-secondary" href={`/panel/klientki?q=${encodeURIComponent(q)}&s=${page - 1}`}>‹ Poprzednie</Link>}
            {page * PAGE < total && <Link className="btn-secondary" href={`/panel/klientki?q=${encodeURIComponent(q)}&s=${page + 1}`}>Następne ›</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
