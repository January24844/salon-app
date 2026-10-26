-- =====================================================================
--  AKTUALIZACJA 003 – panel salonu: płatności, finalizacja wizyt, kasa,
--  statystyki dla właścicielki, zapis wizyty jednym poleceniem.
--  Uruchom RAZ w Supabase → SQL Editor (po baza_od_zera.sql).
--  Można uruchomić ponownie – nic się nie zdubluje.
-- =====================================================================

-- ---------- Ustawienia: godziny kalendarza i VAT -------------------
alter table salon_settings add column if not exists calendar_start time not null default '08:00';
alter table salon_settings add column if not exists calendar_end   time not null default '21:00';
alter table salon_settings add column if not exists vat_rate numeric(4,1) not null default 23;

-- ---------- Wizyty: data finalizacji --------------------------------
alter table appointments add column if not exists finalized_at timestamptz;

-- ---------- Metody płatności ----------------------------------------
create table if not exists payment_methods (
  code              text primary key,
  name              text not null,
  counts_to_revenue boolean not null default true,  -- czy wliczać do utargu
  is_cash           boolean not null default false, -- czy trafia do kasy (gotówka)
  active            boolean not null default true,
  sort_order        int not null default 0
);
insert into payment_methods (code, name, counts_to_revenue, is_cash, sort_order) values
  ('gotowka',    'gotówka',          true,  true,  1),
  ('karta',      'karta kredytowa',  true,  false, 2),
  ('blik',       'BLIK',             true,  false, 3),
  ('przelew',    'przelew',          true,  false, 4),
  ('przedplata', 'z przedpłaty',     true,  false, 5),
  ('karnet',     'karnet / pakiet',  false, false, 6),
  ('bon',        'bon podarunkowy',  false, false, 7),
  ('inne',       'inne',             false, false, 8)
on conflict (code) do nothing;

-- ---------- Płatności (każda sprzedaż i wpłata) ---------------------
create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('usluga', 'towar', 'karnet', 'bon', 'przedplata')),
  method_code    text not null references payment_methods(code),
  amount         numeric(10,2) not null check (amount >= 0),   -- brutto
  vat_rate       numeric(4,1) not null default 23,
  appointment_id uuid references appointments(id) on delete cascade,
  client_id      uuid references clients(id) on delete set null,
  staff_id       uuid references staff(id) on delete set null,  -- komu liczyć sprzedaż
  paid_at        timestamptz not null default now(),
  note           text,
  created_by     uuid references profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists payments_paid_idx on payments (paid_at);
create index if not exists payments_appt_idx on payments (appointment_id);

-- ---------- Kasa: wpływy i wydatki ręczne ---------------------------
create table if not exists cash_entries (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null check (direction in ('in', 'out')),
  amount      numeric(10,2) not null check (amount > 0),
  description text not null,
  entry_at    timestamptz not null default now(),
  created_by  uuid references profiles(id) default auth.uid()
);

-- ---------- Bezpieczeństwo ------------------------------------------
-- Pracownice mogą zapisywać płatności, ale przeglądać obroty może tylko właścicielka.
alter table payment_methods enable row level security;
alter table payments        enable row level security;
alter table cash_entries    enable row level security;

drop policy if exists "team read"   on payment_methods;
drop policy if exists "owner all"   on payment_methods;
drop policy if exists "team insert" on payments;
drop policy if exists "owner all"   on payments;
drop policy if exists "team insert" on cash_entries;
drop policy if exists "owner all"   on cash_entries;

create policy "team read"   on payment_methods for select using (is_team());
create policy "owner all"   on payment_methods for all
  using (current_role_name() = 'owner') with check (current_role_name() = 'owner');
create policy "team insert" on payments for insert with check (is_team());
create policy "owner all"   on payments for all
  using (current_role_name() = 'owner') with check (current_role_name() = 'owner');
create policy "team insert" on cash_entries for insert with check (is_team());
create policy "owner all"   on cash_entries for all
  using (current_role_name() = 'owner') with check (current_role_name() = 'owner');

-- =====================================================================
--  ZAPIS WIZYTY – jedno polecenie: wizyta + usługi + etykiety + przedpłata
--  (+ ewentualnie nowa klientka). Wszystko albo nic.
-- =====================================================================
create or replace function save_appointment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid := nullif(p->>'id', '')::uuid;
  v_client    uuid := nullif(p->>'client_id', '')::uuid;
  v_start     timestamptz := (p->>'starts_at')::timestamptz;
  v_end       timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_minutes   int;
  v_price     numeric(10,2);
  v_dep       numeric(10,2) := nullif(p->'deposit'->>'amount', '')::numeric;
  v_dep_m     text := nullif(p->'deposit'->>'method', '');
  v_old_dep   numeric(10,2);
  v_old_m     text;
  v_vat       numeric(4,1);
  s           jsonb;
  i           int := 0;
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  if jsonb_array_length(coalesce(p->'services', '[]')) = 0 then
    raise exception 'Wybierz co najmniej jedną usługę';
  end if;

  -- nowa klientka
  if v_client is null then
    if coalesce(trim(p->'new_client'->>'first_name'), '') = '' then
      raise exception 'Wybierz klientkę albo wpisz imię nowej klientki';
    end if;
    insert into clients (first_name, last_name, phone, email)
    values (trim(p->'new_client'->>'first_name'),
            nullif(trim(p->'new_client'->>'last_name'), ''),
            nullif(trim(p->'new_client'->>'phone'), ''),
            nullif(trim(p->'new_client'->>'email'), ''))
    returning id into v_client;
  end if;

  select coalesce(sum((x->>'duration_minutes')::int), 0), coalesce(sum((x->>'price')::numeric), 0)
    into v_minutes, v_price
  from jsonb_array_elements(p->'services') x;
  if v_end is null then v_end := v_start + make_interval(mins => v_minutes); end if;

  if v_id is null then
    insert into appointments (client_id, staff_id, room_id, starts_at, ends_at, price,
                              staff_note, deposit_amount, deposit_method, deposit_paid_at,
                              created_by, source)
    values (v_client, (p->>'staff_id')::uuid, nullif(p->>'room_id', '')::uuid, v_start, v_end, v_price,
            nullif(p->>'note', ''), v_dep, v_dep_m, case when v_dep > 0 then now() end,
            auth.uid(), 'salon')
    returning id into v_id;
  else
    select deposit_amount, deposit_method into v_old_dep, v_old_m from appointments where id = v_id;
    update appointments set
      client_id = v_client, staff_id = (p->>'staff_id')::uuid,
      room_id = nullif(p->>'room_id', '')::uuid,
      starts_at = v_start, ends_at = v_end, price = v_price,
      staff_note = nullif(p->>'note', ''),
      deposit_amount = v_dep, deposit_method = v_dep_m,
      deposit_paid_at = case when v_dep > 0 then coalesce(deposit_paid_at, now()) end
    where id = v_id and status in ('booked', 'confirmed');
    if not found then raise exception 'Tej wizyty nie można już edytować (jest zakończona lub odwołana)'; end if;
    delete from appointment_services where appointment_id = v_id;
    delete from appointment_labels   where appointment_id = v_id;
  end if;

  for s in select * from jsonb_array_elements(p->'services') loop
    insert into appointment_services (appointment_id, service_id, position, duration_minutes, price, client_package_id)
    values (v_id, (s->>'service_id')::uuid, i, (s->>'duration_minutes')::int, (s->>'price')::numeric,
            nullif(s->>'client_package_id', '')::uuid);
    i := i + 1;
  end loop;

  insert into appointment_labels (appointment_id, label_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p->'labels', '[]')) x
  on conflict do nothing;

  -- przedpłata = wpłata do kasy (zapisywana raz, aktualizowana przy zmianie kwoty)
  if coalesce(v_dep, 0) <> coalesce(v_old_dep, 0) or v_dep_m is distinct from v_old_m then
    delete from payments where appointment_id = v_id and kind = 'przedplata';
    if coalesce(v_dep, 0) > 0 then
      select vat_rate into v_vat from salon_settings where id = 1;
      insert into payments (kind, method_code, amount, vat_rate, appointment_id, client_id,
                            staff_id, created_by)
      values ('przedplata', coalesce(v_dep_m, 'gotowka'), v_dep, coalesce(v_vat, 23), v_id, v_client,
              (p->>'staff_id')::uuid, auth.uid());
    end if;
  end if;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'W tym czasie ta pracownica (lub gabinet) ma już inną wizytę';
end $$;

-- =====================================================================
--  FINALIZACJA WIZYTY – zapis płatności (można podzielić na kilka metod)
--  p_payments: [{"method":"gotowka","amount":200}, {"method":"karta","amount":100}]
-- =====================================================================
create or replace function finalize_appointment(p_id uuid, p_payments jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a     appointments%rowtype;
  x     jsonb;
  v_vat numeric(4,1);
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'Nie ma takiej wizyty'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'Wizyta jest już zakończona lub odwołana'; end if;
  select vat_rate into v_vat from salon_settings where id = 1;

  for x in select * from jsonb_array_elements(coalesce(p_payments, '[]')) loop
    if coalesce((x->>'amount')::numeric, 0) > 0 then
      insert into payments (kind, method_code, amount, vat_rate, appointment_id, client_id, staff_id, created_by)
      values ('usluga', x->>'method', (x->>'amount')::numeric, coalesce(v_vat, 23),
              a.id, a.client_id, a.staff_id, auth.uid());
    end if;
  end loop;

  update appointments set status = 'completed', finalized_at = now(),
    price = coalesce((select sum((y->>'amount')::numeric) from jsonb_array_elements(p_payments) y), price),
    staff_note = coalesce(nullif(p_note, ''), staff_note)
  where id = p_id;
end $$;

-- cofnięcie finalizacji (np. pomyłka przy płatności) – tylko właścicielka
create or replace function unfinalize_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_role_name() <> 'owner' then raise exception 'Tylko właścicielka może cofnąć finalizację'; end if;
  delete from payments where appointment_id = p_id and kind = 'usluga';
  update appointments set status = 'booked', finalized_at = null where id = p_id and status = 'completed';
end $$;

-- =====================================================================
--  STATYSTYKI (jak w Versum) – tylko dla właścicielki
-- =====================================================================
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
    where (p.kind = 'usluga' and p.appointment_id in (select id from appts))
       or (p.kind <> 'usluga' and p.paid_at >= p_from and p.paid_at < p_to)
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

-- funkcje dostępne dla zalogowanych
grant execute on function save_appointment(jsonb) to authenticated;
grant execute on function finalize_appointment(uuid, jsonb, text) to authenticated;
grant execute on function unfinalize_appointment(uuid) to authenticated;
grant execute on function stats_report(timestamptz, timestamptz) to authenticated;
