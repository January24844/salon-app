-- =====================================================================
--  AKTUALIZACJA 005 – gabinety i urządzenia jako kolumny w kalendarzu
--  (Laser, pokój zabiegowy, pokój laserowy, Endermologia LPG).
--  Uruchom RAZ w Supabase → SQL Editor. Można uruchomić ponownie.
-- =====================================================================

alter table rooms add column if not exists color      text not null default '#9AD9D2';
alter table rooms add column if not exists sort_order int  not null default 0;
alter table rooms add column if not exists open_time  time not null default '10:00';
alter table rooms add column if not exists close_time time not null default '21:00';

insert into rooms (name, color, sort_order, open_time, close_time)
select v.name, v.color, v.ord, '10:00', '21:00' from (values
  ('Laser',             '#F7C59F', 1),
  ('pokój zabiegowy',   '#7FD8C6', 2),
  ('pokój laserowy',    '#D7B8F3', 3),
  ('Endermologia LPG',  '#B8C4D6', 4)
) as v(name, color, ord)
where not exists (select 1 from rooms r where r.name = v.name);

-- Domyślne przypisania zabiegów (można zmienić w aplikacji: Pracownice → Gabinety)
insert into service_rooms (service_id, room_id)
select s.id, r.id from services s join rooms r on r.name = 'Laser'
where s.name ilike 'LASER %' or s.name ilike 'Laser %'
on conflict do nothing;

insert into service_rooms (service_id, room_id)
select s.id, r.id from services s join rooms r on r.name = 'Endermologia LPG'
where s.name ilike '%LPG%'
on conflict do nothing;

-- odczyt gabinetów potrzebny także do rezerwacji online (wolne terminy)
drop policy if exists "public read" on rooms;
create policy "public read" on rooms for select using (active);
drop policy if exists "public read" on service_rooms;
create policy "public read" on service_rooms for select using (true);
