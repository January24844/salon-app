-- =====================================================================
--  AKTUALIZACJA 016 – GRAFIKI PRACY (jak w Versum) + SZABLONY GRAFIKU
--  • rodzaj dnia w grafiku: praca / dzień wolny / urlop / L4 / święto
--  • dni, w które salon jest nieczynny (domyślnie niedziela)
--  • szablony grafiku pracownicy (1–4 tygodnie) i wstawianie z szablonu
--  Uruchom RAZ w Supabase → SQL Editor. Można uruchomić ponownie.
-- =====================================================================

-- ---------- Rodzaj dnia w grafiku ----------------------------------
alter table staff_schedule_days add column if not exists kind text not null default 'work';
do $$ begin
  alter table staff_schedule_days add constraint staff_schedule_days_kind_check
    check (kind in ('work', 'off', 'vacation', 'sick', 'holiday'));
exception when duplicate_object then null; end $$;

-- dotychczasowe "dzień wolny" → kind = off
update staff_schedule_days set kind = 'off' where is_day_off and kind = 'work';

-- is_day_off pilnowane automatycznie na podstawie kind
create or replace function sync_schedule_kind() returns trigger language plpgsql as $$
begin
  if new.kind = 'work' and new.is_day_off and (new.start_time is null or new.end_time is null) then
    new.kind := 'off';                      -- zgodność ze starszą wersją aplikacji
  end if;
  new.is_day_off := new.kind <> 'work';
  if new.is_day_off then
    new.start_time := null;
    new.end_time := null;
  end if;
  return new;
end $$;

drop trigger if exists staff_schedule_days_sync on staff_schedule_days;
create trigger staff_schedule_days_sync before insert or update on staff_schedule_days
  for each row execute function sync_schedule_kind();

create index if not exists staff_schedule_days_day_idx on staff_schedule_days (day);

-- ---------- Dni nieczynne salonu (1 = pon … 7 = niedz) ---------------
alter table salon_settings add column if not exists closed_weekdays smallint[] not null default '{7}';

-- ---------- "Grafik do …" dla każdej pracownicy ---------------------
create or replace view staff_schedule_until with (security_invoker = true) as
select staff_id, max(day) as until from staff_schedule_days group by staff_id;

-- ---------- Szablony grafiku ----------------------------------------
create table if not exists schedule_templates (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff(id) on delete cascade,
  name       text not null,
  weeks      smallint not null default 1 check (weeks between 1 and 4),
  created_at timestamptz not null default now()
);

create table if not exists schedule_template_days (
  template_id uuid not null references schedule_templates(id) on delete cascade,
  week_no     smallint not null check (week_no between 1 and 4),
  weekday     smallint not null check (weekday between 1 and 7),
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  primary key (template_id, week_no, weekday)
);

alter table schedule_templates     enable row level security;
alter table schedule_template_days enable row level security;
drop policy if exists "team all" on schedule_templates;
drop policy if exists "team all" on schedule_template_days;
create policy "team all" on schedule_templates     for all using (is_team()) with check (is_team());
create policy "team all" on schedule_template_days for all using (is_team()) with check (is_team());

-- =====================================================================
--  WSTAW Z SZABLONU
--  Dzień z godzinami w szablonie → praca, dzień bez godzin → dzień wolny.
--  p_start_week: od którego tygodnia szablonu zacząć (dla rotacji 2–4 tyg.)
--  p_overwrite:  czy zastępować wpisane już dni pracy / wolne.
--  Urlopów, L4 i świąt NIGDY nie nadpisuje.
--  Dni, w które salon jest nieczynny, pomija.
-- =====================================================================
create or replace function apply_schedule_template(
  p_template_id uuid, p_from date, p_to date,
  p_start_week int default 1, p_overwrite boolean default true
) returns int
language plpgsql security definer set search_path = public as $$
declare
  t        schedule_templates%rowtype;
  d        date;
  wk       int;
  td       schedule_template_days%rowtype;
  existing staff_schedule_days%rowtype;
  closed   smallint[];
  n        int := 0;
  base     date := p_from - (extract(isodow from p_from)::int - 1);   -- poniedziałek tygodnia startu
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  if p_to < p_from then raise exception 'Data końcowa jest wcześniejsza niż początkowa'; end if;
  if p_to - p_from > 400 then raise exception 'Maksymalnie ok. 13 miesięcy naraz'; end if;
  select * into t from schedule_templates where id = p_template_id;
  if not found then raise exception 'Nie ma takiego szablonu'; end if;
  select closed_weekdays into closed from salon_settings where id = 1;

  d := p_from;
  while d <= p_to loop
    if not (extract(isodow from d)::smallint = any (coalesce(closed, '{}'))) then
      wk := (((d - base) / 7) + greatest(p_start_week, 1) - 1) % t.weeks + 1;
      select * into td from schedule_template_days
        where template_id = t.id and week_no = wk and weekday = extract(isodow from d)::int;
      select * into existing from staff_schedule_days where staff_id = t.staff_id and day = d;

      if existing.id is null or (p_overwrite and existing.kind in ('work', 'off')) then
        insert into staff_schedule_days (staff_id, day, kind, start_time, end_time)
        values (t.staff_id, d,
                case when td.template_id is null then 'off' else 'work' end,
                td.start_time, td.end_time)
        on conflict (staff_id, day) do update
          set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time;
        n := n + 1;
      end if;
      existing := null;
      td := null;
    end if;
    d := d + 1;
  end loop;
  return n;
end $$;

-- wyczyszczenie grafiku w okresie (urlopy / L4 / święta zostają, chyba że p_all)
create or replace function clear_schedule(p_staff_id uuid, p_from date, p_to date, p_all boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_team() then raise exception 'Brak uprawnień'; end if;
  delete from staff_schedule_days
  where staff_id = p_staff_id and day between p_from and p_to
    and (p_all or kind in ('work', 'off'));
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function apply_schedule_template(uuid, date, date, int, boolean) to authenticated;
grant execute on function clear_schedule(uuid, date, date, boolean) to authenticated;
