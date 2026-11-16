-- =====================================================================
--  AKTUALIZACJA 012 – wizyty mogą na siebie nachodzić u jednej pracownicy
--  (w kalendarzu wyświetlają się obok siebie, jak w Versum).
--  Gabinety / urządzenia (np. Laser) nadal nie mogą być zajęte podwójnie.
--  Cofa też zmianę "usługi jednocześnie" (011), jeśli była uruchomiona.
--  Uruchom RAZ w Supabase → SQL Editor. Można uruchomić ponownie.
-- =====================================================================

-- 1. Zdejmujemy blokadę nakładania się wizyt u tej samej pracownicy
alter table appointments drop constraint if exists no_staff_overlap;

-- 2. Funkcja zapisu wizyty (wersja bez "usług jednocześnie")
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
    raise exception 'W tym czasie ten gabinet / urządzenie jest już zajęty przez inną wizytę';
end $$;

grant execute on function save_appointment(jsonb) to authenticated;

-- 3. Sprzątanie po 011 (jeśli była uruchomiona)
alter table appointment_services drop column if exists parallel;
