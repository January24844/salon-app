import PanelNav from "@/components/PanelNav";
import { requireTeam } from "@/lib/auth";

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  const { role, user, fullName } = await requireTeam();

  if (role === "client") {
    return (
      <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center">
        <h1 className="font-serif text-3xl">Brak dostępu</h1>
        <p className="mt-3 text-muted">
          Konto {user.email} nie ma jeszcze uprawnień do panelu salonu. Poproś właścicielkę o nadanie dostępu.
        </p>
        <a href="/logowanie" className="btn-primary mt-6 inline-block">Zaloguj na inne konto</a>
      </main>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PanelNav isOwner={role === "owner"} name={fullName || user.email || ""} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
