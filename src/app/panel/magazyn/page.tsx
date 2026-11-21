import WarehouseView from "@/components/warehouse/WarehouseView";
import { requireTeam } from "@/lib/auth";
import type { Delivery, PaymentMethod, Product, ProductCategory, Staff, StockMovement } from "@/lib/types";

const MOVEMENT = `id, product_id, change, reason, unit_price, unit_cost, note, created_at, appointment_id,
  product:products(name, capacity_ml), client:clients(first_name, last_name), staff:staff(full_name)`;

export default async function WarehousePage() {
  const { supabase, role } = await requireTeam();
  const [products, categories, sales, usage, deliveries, staff, methods] = await Promise.all([
    supabase.from("products").select("*").order("name"),
    supabase.from("product_categories").select("*").order("sort_order").order("name"),
    supabase.from("stock_movements").select(MOVEMENT).eq("reason", "sprzedaz").order("created_at", { ascending: false }).limit(2000),
    supabase.from("stock_movements").select(MOVEMENT).eq("reason", "zuzycie").order("created_at", { ascending: false }).limit(2000),
    supabase
      .from("deliveries")
      .select("*, stock_movements(change, unit_cost, product:products(name))")
      .order("issued_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("staff").select("*").eq("active", true).order("sort_order"),
    supabase.from("payment_methods").select("*").eq("active", true).order("sort_order"),
  ]);

  const err = [products, categories, sales, usage, deliveries].find((r) => r.error)?.error;
  if (err) {
    return (
      <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Nie udało się wczytać magazynu: {err.message}. Sprawdź, czy w Supabase uruchomiono pliki
        <code className="mx-1">013_magazyn.sql</code> i <code className="mx-1">015_dostawy.sql</code>.
      </div>
    );
  }

  return (
    <WarehouseView
      products={(products.data ?? []) as Product[]}
      categories={(categories.data ?? []) as ProductCategory[]}
      sales={(sales.data ?? []) as unknown as StockMovement[]}
      usage={(usage.data ?? []) as unknown as StockMovement[]}
      deliveries={(deliveries.data ?? []) as unknown as Delivery[]}
      staff={(staff.data ?? []) as Staff[]}
      methods={(methods.data ?? []) as PaymentMethod[]}
      isOwner={role === "owner"}
    />
  );
}
