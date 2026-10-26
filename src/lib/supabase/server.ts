import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Połączenie z bazą po stronie serwera (strony, akcje serwera).
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // wywołane z komponentu serwera – sesję odświeży proxy.ts
          }
        },
      },
    },
  );
}
