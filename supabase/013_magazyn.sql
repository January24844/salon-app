-- =====================================================================
--  AKTUALIZACJA 013 – MAGAZYN
--  Produkty (towary i materiały), stany, dostawy, korekty, zużycie,
--  sprzedaż produktów (osobno lub przy finalizacji wizyty) + statystyki.
--  Uruchom RAZ w Supabase → SQL Editor. Można uruchomić ponownie.
-- =====================================================================

-- ---------- Kategorie produktów -------------------------------------
create table if not exists product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int not null default 0
);

-- ---------- Produkty ------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id) on delete set null,
  name        text not null,
  kind        text not null default 'towar'
              check (kind in ('towar', 'material', 'towar_material')),  -- na sprzedaż / do zabiegów / oba
  sku         text,                                   -- kod wewnętrzny
  capacity_ml numeric(10,2),                          -- pojemność opakowania (informacyjnie)
  stock       numeric(10,2) not null default 0,       -- stan w opakowaniach
  min_stock   numeric(10,2),                          -- poniżej – ostrzeżenie "kończy się"
  price       numeric(10,2) not null default 0,       -- cena sprzedaży brutto
  vat_rate    numeric(4,1)  not null default 23,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists products_name_idx on products (lower(name));

-- ---------- Ruchy magazynowe ----------------------------------------
-- każdy ruch zmienia stan produktu (trigger poniżej)
create table if not exists stock_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  change         numeric(10,2) not null,              -- + przyjęcie, − wydanie
  reason         text not null check (reason in ('dostawa', 'sprzedaz', 'zuzycie', 'korekta')),
  unit_price     numeric(10,2),                       -- przy sprzedaży: cena za sztukę
  appointment_id uuid references appointments(id) on delete set null,
  client_id      uuid references clients(id) on delete set null,
  staff_id       uuid references staff(id) on delete set null,
  note           text,
  created_by     uuid references profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);
create index if not exists stock_movements_appt_idx on stock_movements (appointment_id);

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update products set stock = stock + new.change where id = new.product_id;
    return new;
  else -- DELETE: cofamy ruch
    update products set stock = stock - old.change where id = old.product_id;
    return old;
  end if;
end $$;

drop trigger if exists stock_movements_apply on stock_movements;
create trigger stock_movements_apply after insert or delete on stock_movements
  for each row execute function apply_stock_movement();

-- ---------- Bezpieczeństwo ------------------------------------------
alter table product_categories enable row level security;
alter table products           enable row level security;
alter table stock_movements    enable row level security;

drop policy if exists "team all" on product_categories;
drop policy if exists "team all" on products;
drop policy if exists "team read" on stock_movements;
drop policy if exists "team insert" on stock_movements;
drop policy if exists "owner all" on stock_movements;

create policy "team all" on product_categories for all using (is_team()) with check (is_team());
create policy "team all" on products           for all using (is_team()) with check (is_team());
create policy "team read"   on stock_movements for select using (is_team());
create policy "team insert" on stock_movements for insert with check (is_team() and reason <> 'sprzedaz');
create policy "owner all"   on stock_movements for all
  using (current_role_name() = 'owner') with check (current_role_name() = 'owner');

-- =====================================================================
--  SPRZEDAŻ PRODUKTÓW
--  p_items:    [{"product_id": "...", "qty": 1, "price": 145}]
--  p_payments: [{"method": "karta", "amount": 145}]
--  Zapisuje wydanie z magazynu i płatność (kind = 'towar' → statystyki).
-- =====================================================================
create or replace function sell_products(
  p_items jsonb, p_payments jsonb,
  p_client_id uuid default null, p_staff_id uuid default null,
  p_appointment_id uuid default null, p_note text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  x       jsonb;
  v_total numeric(10,2) := 0;
  v_vat   numeric(4,1);
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then return 0; end if;

  for x in select * from jsonb_array_elements(p_items) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    insert into stock_movements (product_id, change, reason, unit_price, appointment_id, client_id, staff_id, note)
    values ((x->>'product_id')::uuid, -(x->>'qty')::numeric, 'sprzedaz', (x->>'price')::numeric,
            p_appointment_id, p_client_id, p_staff_id, p_note);
    v_total := v_total + (x->>'qty')::numeric * (x->>'price')::numeric;
  end loop;

  -- płatności tylko przy sprzedaży poza wizytą (przy wizycie rozlicza je finalizacja)
  if p_appointment_id is null then
    select vat_rate into v_vat from salon_settings where id = 1;
    for x in select * from jsonb_array_elements(coalesce(p_payments, '[]')) loop
      if coalesce((x->>'amount')::numeric, 0) > 0 then
        insert into payments (kind, method_code, amount, vat_rate, client_id, staff_id, note, created_by)
        values ('towar', x->>'method', (x->>'amount')::numeric, coalesce(v_vat, 23),
                p_client_id, p_staff_id, p_note, auth.uid());
      end if;
    end loop;
  end if;
  return v_total;
end $$;

-- =====================================================================
--  FINALIZACJA WIZYTY – teraz także z produktami
--  Płatności dzielone proporcjonalnie na usługi i produkty (statystyki).
-- =====================================================================
drop function if exists finalize_appointment(uuid, jsonb, text);
create or replace function finalize_appointment(
  p_id uuid, p_payments jsonb, p_note text default null, p_products jsonb default '[]'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  a        appointments%rowtype;
  x        jsonb;
  v_vat    numeric(4,1);
  v_paid   numeric(10,2);
  v_prod   numeric(10,2);
  v_share  numeric;
  v_towar  numeric(10,2);
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'Nie ma takiej wizyty'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'Wizyta jest już zakończona lub odwołana'; end if;
  select vat_rate into v_vat from salon_settings where id = 1;

  select coalesce(sum((y->>'amount')::numeric), 0) into v_paid
  from jsonb_array_elements(coalesce(p_payments, '[]')) y;
  select coalesce(sum((y->>'qty')::numeric * (y->>'price')::numeric), 0) into v_prod
  from jsonb_array_elements(coalesce(p_products, '[]')) y where (y->>'qty')::numeric > 0;
  v_share := case when v_paid > 0 then least(v_prod, v_paid) / v_paid else 0 end;

  -- produkty: wydanie z magazynu
  perform sell_products(p_products, null, a.client_id, a.staff_id, a.id, null);

  -- płatności: część za produkty (towar), reszta za usługi
  for x in select * from jsonb_array_elements(coalesce(p_payments, '[]')) loop
    if coalesce((x->>'amount')::numeric, 0) > 0 then
      v_towar := round((x->>'amount')::numeric * v_share, 2);
      if v_towar > 0 then
        insert into payments (kind, method_code, amount, vat_rate, appointment_id, client_id, staff_id, created_by)
        values ('towar', x->>'method', v_towar, coalesce(v_vat, 23), a.id, a.client_id, a.staff_id, auth.uid());
      end if;
      if (x->>'amount')::numeric - v_towar > 0 then
        insert into payments (kind, method_code, amount, vat_rate, appointment_id, client_id, staff_id, created_by)
        values ('usluga', x->>'method', (x->>'amount')::numeric - v_towar, coalesce(v_vat, 23),
                a.id, a.client_id, a.staff_id, auth.uid());
      end if;
    end if;
  end loop;

  update appointments set status = 'completed', finalized_at = now(),
    price = greatest(v_paid - least(v_prod, v_paid), 0),
    staff_note = coalesce(nullif(p_note, ''), staff_note)
  where id = p_id;
end $$;

-- cofnięcie finalizacji: zwraca też produkty na stan
create or replace function unfinalize_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_role_name() <> 'owner' then raise exception 'Tylko właścicielka może cofnąć finalizację'; end if;
  delete from payments where appointment_id = p_id and kind in ('usluga', 'towar');
  delete from stock_movements where appointment_id = p_id and reason = 'sprzedaz';
  update appointments set status = 'booked', finalized_at = null where id = p_id and status = 'completed';
end $$;

-- statystyki: produkty sprzedane przy wizycie liczą się do dnia wizyty (jak usługi)
create or replace function stats_report(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  if current_role_name() <> 'owner' then raise exception 'Statystyki są dostępne tylko dla właścicielki'; end if;

  with
  appts as (   -- sfinalizowane wizyty w okresie
    select * from appointments
    where status = 'completed' and starts_at >= p_from and starts_at < p_to
  ),
  pay as (     -- płatności: za usługi wg daty wizyty, reszta wg daty wpłaty
    select p.*, m.counts_to_revenue, m.is_cash, m.name as method_name,
           round(p.amount / (1 + p.vat_rate / 100), 2) as net
    from payments p join payment_methods m on m.code = p.method_code
    where (p.kind in ('usluga', 'towar') and p.appointment_id in (select id from appts))
       or (p.appointment_id is null and p.paid_at >= p_from and p.paid_at < p_to)
       or (p.kind not in ('usluga', 'towar') and p.appointment_id is not null
           and p.paid_at >= p_from and p.paid_at < p_to)
  ),
  counted as (select * from pay where counts_to_revenue),
  cash as (
    select coalesce((select sum(amount) from pay where is_cash), 0)
         + coalesce((select sum(amount) from cash_entries where direction = 'in'
                     and entry_at >= p_from and entry_at < p_to), 0) as cash_in,
           coalesce((select sum(amount) from cash_entries where direction = 'out'
                     and entry_at >= p_from and entry_at < p_to), 0) as cash_out
  ),
  per_staff as (
    select st.id, st.full_name, st.color, st.sort_order,
      (select count(*) from appts a where a.staff_id = st.id) as visits,
      (select coalesce(sum(extract(epoch from a.ends_at - a.starts_at) / 60), 0)::int
         from appts a where a.staff_id = st.id) as minutes,
      coalesce(sum(p.amount) filter (where p.kind = 'usluga'), 0) as services_gross,
      coalesce(sum(p.net)    filter (where p.kind = 'usluga'), 0) as services_net,
      coalesce(sum(p.amount) filter (where p.kind = 'towar'), 0)  as products_gross,
      coalesce(sum(p.net)    filter (where p.kind = 'towar'), 0)  as products_net,
      coalesce(sum(p.amount) filter (where p.kind = 'karnet'), 0) as packages_gross,
      coalesce(sum(p.net)    filter (where p.kind = 'karnet'), 0) as packages_net,
      coalesce(sum(p.amount) filter (where p.kind = 'bon'), 0)    as vouchers_gross,
      coalesce(sum(p.net)    filter (where p.kind = 'bon'), 0)    as vouchers_net,
      coalesce(sum(p.amount) filter (where p.kind in ('usluga', 'towar', 'karnet', 'bon')), 0) as revenue_gross
    from staff st
    left join pay p on p.staff_id = st.id
    where st.active or exists (select 1 from appts a where a.staff_id = st.id)
    group by st.id
  )
  select jsonb_build_object(
    'visits',        (select count(*) from appts),
    'visit_minutes', (select coalesce(sum(extract(epoch from ends_at - starts_at) / 60), 0)::int from appts),
    'services_gross', (select coalesce(sum(amount), 0) from counted where kind = 'usluga'),
    'services_net',   (select coalesce(sum(net), 0)    from counted where kind = 'usluga'),
    'products_gross', (select coalesce(sum(amount), 0) from counted where kind = 'towar'),
    'products_net',   (select coalesce(sum(net), 0)    from counted where kind = 'towar'),
    'packages_gross', (select coalesce(sum(amount), 0) from counted where kind = 'karnet'),
    'packages_net',   (select coalesce(sum(net), 0)    from counted where kind = 'karnet'),
    'revenue_gross',  (select coalesce(sum(amount), 0) from counted where kind in ('usluga', 'towar')),
    'vouchers_gross', (select coalesce(sum(amount), 0) from pay where kind = 'bon'),
    'deposits_gross', (select coalesce(sum(amount), 0) from pay where kind = 'przedplata'),
    'cash_in',  (select cash_in from cash),
    'cash_out', (select cash_out from cash),
    'non_revenue_total',    (select coalesce(sum(amount), 0) from pay where not counts_to_revenue and kind in ('usluga', 'towar')),
    'non_revenue_services', (select coalesce(sum(amount), 0) from pay where not counts_to_revenue and kind = 'usluga'),
    'non_revenue_products', (select coalesce(sum(amount), 0) from pay where not counts_to_revenue and kind = 'towar'),
    'methods', coalesce((
       select jsonb_agg(jsonb_build_object('name', method_name, 'amount', amt) order by amt desc)
       from (select method_name, sum(amount) amt from counted where kind in ('usluga', 'towar')
             group by method_name) t), '[]'),
    'staff', coalesce((
       select jsonb_agg(to_jsonb(ps) - 'sort_order' order by ps.sort_order, ps.full_name)
       from per_staff ps), '[]')
  ) into r;
  return r;
end $$;

grant execute on function sell_products(jsonb, jsonb, uuid, uuid, uuid, text) to authenticated;
grant execute on function finalize_appointment(uuid, jsonb, text, jsonb) to authenticated;
grant execute on function unfinalize_appointment(uuid) to authenticated;
grant execute on function stats_report(timestamptz, timestamptz) to authenticated;
