import WarehouseView from "@/components/warehouse/WarehouseView";
import { requireTeam } from "@/lib/auth";
import type { PaymentMethod, Product, ProductCategory, Staff, StockMovement } from "@/lib/types";

export default async function WarehousePage() {
  const { supabase, role } = await requireTeam();
  const [products, categories, movements, staff, methods] = await Promise.all([
    supabase.from("products").select("*").order("name"),
    supabase.from("product_categories").select("*").order("sort_order").order("name"),
    supabase
      .from("stock_movements")
      .select(
        "id, product_id, change, reason, unit_price, note, created_at, appointment_id, product:products(name), client:clients(first_name, last_name), staff:staff(full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("staff").select("*").eq("active", true).order("sort_order"),
    supabase.from("payment_methods").select("*").eq("active", true).order("sort_order"),
  ]);

  const err = [products, categories, movements].find((r) => r.error)?.error;
  if (err) {
    return (
      <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Nie udało się wczytać magazynu: {err.message}. Sprawdź, czy w Supabase uruchomiono plik
        <code className="mx-1">013_magazyn.sql</code>.
      </div>
    );
  }

  return (
    <WarehouseView
      products={(products.data ?? []) as Product[]}
      categories={(categories.data ?? []) as ProductCategory[]}
      movements={(movements.data ?? []) as unknown as StockMovement[]}
      staff={(staff.data ?? []) as Staff[]}
      methods={(methods.data ?? []) as PaymentMethod[]}
      isOwner={role === "owner"}
    />
  );
}
