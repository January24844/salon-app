"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/panel", label: "Kalendarz" },
  { href: "/panel/klientki", label: "Klientki" },
  { href: "/panel/pracownice", label: "Pracownice" },
  { href: "/panel/zabiegi", label: "Zabiegi" },
];

export default function PanelNav({ isOwner, name }: { isOwner: boolean; name: string }) {
  const path = usePathname();
  const router = useRouter();
  const links = isOwner ? [...LINKS, { href: "/panel/statystyki", label: "Statystyki" }] : LINKS;

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/logowanie");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur print:hidden">
      <div className="flex items-center gap-2 px-2 sm:gap-4 sm:px-4">
        <Link href="/panel" className="hidden py-3 font-serif text-xl whitespace-nowrap md:block">NY Laser Center</Link>
        <nav className="-mb-px flex flex-1 gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = l.href === "/panel" ? path === "/panel" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 text-sm ${
                  active ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center gap-3 text-sm text-muted sm:flex">
          <span className="max-w-48 truncate">{name}</span>
        </div>
        <button onClick={logout} className="btn-ghost text-sm">Wyloguj</button>
      </div>
    </header>
  );
}
