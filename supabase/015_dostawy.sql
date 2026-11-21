-- =====================================================================
--  AKTUALIZACJA 015 – MAGAZYN: dostawy jako dokumenty (jak w Versum)
--  Dostawa = dokument (faktura / paragon / WZ) z kilkoma pozycjami,
--  numerem, dostawcą i cenami zakupu. Zużycie z pracownicą i klientką.
--  Uruchom RAZ w Supabase → SQL Editor (po 013). Można uruchomić ponownie.
-- =====================================================================

create table if not exists deliveries (
  id              uuid primary key default gen_random_uuid(),
  document_type   text not null default 'faktura'
                  check (document_type in ('faktura', 'paragon', 'wz', 'inne')),
  document_number text,
  issued_on       date not null default current_date,   -- data wystawienia dokumentu
  supplier        text,
  note            text,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()      -- wprowadzono
);

alter table stock_movements add column if not exists delivery_id uuid references deliveries(id) on delete cascade;
alter table stock_movements add column if not exists unit_cost numeric(10,2);   -- cena zakupu netto/brutto za op.
create index if not exists stock_movements_delivery_idx on stock_movements (delivery_id);
create index if not exists stock_movements_reason_idx on stock_movements (reason, created_at desc);

alter table deliveries enable row level security;
drop policy if exists "team all" on deliveries;
create policy "team all" on deliveries for all using (is_team()) with check (is_team());

-- =====================================================================
--  NOWA DOSTAWA – dokument + pozycje w jednym kroku
--  p: {"document_type":"faktura","document_number":"FV 1/2026","issued_on":"2026-11-16",
--      "supplier":"Epicuren PL","note":"","items":[{"product_id":"...","qty":3,"unit_cost":80}]}
-- =====================================================================
create or replace function create_delivery(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  x    jsonb;
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then
    raise exception 'Dodaj co najmniej jeden produkt do dostawy';
  end if;

  insert into deliveries (document_type, document_number, issued_on, supplier, note)
  values (coalesce(nullif(p->>'document_type', ''), 'faktura'),
          nullif(trim(p->>'document_number'), ''),
          coalesce(nullif(p->>'issued_on', '')::date, current_date),
          nullif(trim(p->>'supplier'), ''),
          nullif(trim(p->>'note'), ''))
  returning id into v_id;

  for x in select * from jsonb_array_elements(p->'items') loop
    if coalesce((x->>'qty')::numeric, 0) > 0 then
      insert into stock_movements (product_id, change, reason, unit_cost, delivery_id, note)
      values ((x->>'product_id')::uuid, (x->>'qty')::numeric, 'dostawa',
              nullif(x->>'unit_cost', '')::numeric, v_id, nullif(trim(p->>'document_number'), ''));
    end if;
  end loop;
  return v_id;
end $$;

grant execute on function create_delivery(jsonb) to authenticated;
