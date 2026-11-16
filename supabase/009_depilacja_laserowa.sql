-- =====================================================================
--  DEPILACJA LASEROWA – uzupełnia brakujące zabiegi (53 pozycje z Versum).
--  Zabiegi, które już są, zostają (włączane, jeśli były ukryte).
--  Uruchom w Supabase → SQL Editor. Można uruchomić ponownie.
-- =====================================================================
begin;

-- kategorie (tworzone tylko jeśli ich nie ma)
insert into service_categories (name, sort_order) values ('Depilacja laserowa', 60)
on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order)
select v.name, (select id from service_categories where name = 'Depilacja laserowa'), v.ord
from (values ('Depilacja laserowa dla M', 61), ('Depilacja laserowa dla K', 62)) v(name, ord)
on conflict (name) do nothing;

create temp table _laser(name text, g text, mins int, price numeric, price_from boolean, ord int) on commit drop;
insert into _laser values
  ('konsultacja po zabiegu laserem', '', 15, 0, false, 0),
  ('LASER klatka piersiowa K', 'K', 45, 320, false, 1),
  ('LASER baki K', 'K', 30, 200, false, 2),
  ('LASER baki M', 'M', 30, 300, false, 3),
  ('LASER bikini głębokie K', 'K', 80, 400, false, 4),
  ('LASER bikini podstawowe K', 'K', 45, 300, false, 5),
  ('LASER broda K', 'K', 30, 200, false, 6),
  ('LASER broda M', 'M', 30, 350, false, 7),
  ('LASER brodawki K', 'K', 30, 160, false, 8),
  ('LASER brzuch K', 'K', 45, 300, false, 9),
  ('LASER brzuch M', 'M', 60, 360, true, 10),
  ('LASER całe nogi K', 'K', 150, 850, false, 11),
  ('LASER całe nogi M', 'M', 180, 1040, false, 12),
  ('LASER dłonie K', 'K', 30, 100, false, 13),
  ('LASER dłonie M', 'M', 30, 200, false, 14),
  ('LASER górna warga K', 'K', 15, 150, false, 15),
  ('LASER górna warga M', 'M', 30, 240, false, 16),
  ('LASER kark K', 'K', 30, 200, false, 17),
  ('LASER kark M', 'M', 60, 400, false, 18),
  ('LASER klatka piersiowa M', 'M', 60, 360, true, 19),
  ('LASER kolana K', 'K', 30, 80, false, 20),
  ('LASER kolana M', 'M', 45, 120, false, 21),
  ('LASER konsultacja i próba', 'K', 30, 0, false, 22),
  ('LASER lędźwia K', 'K', 60, 320, false, 23),
  ('LASER linia biała K', 'K', 30, 150, false, 24),
  ('LASER linia włosów K', 'K', 30, 250, false, 25),
  ('LASER linia włosów M', 'M', 30, 300, false, 26),
  ('LASER łydki K', 'K', 80, 400, false, 27),
  ('LASER łydki M', 'M', 120, 560, false, 28),
  ('LASER między brwiami K', 'K', 20, 150, false, 29),
  ('LASER między brwiami M', 'M', 20, 200, false, 30),
  ('Laser między pośladkami K', 'K', 30, 160, false, 31),
  ('Laser między pośladkami M', 'M', 45, 230, false, 32),
  ('LASER pachy K', 'K', 30, 250, false, 33),
  ('LASER pachy M', 'M', 60, 300, false, 34),
  ('LASER plecy M', 'M', 120, 700, false, 35),
  ('LASER policzki', 'K', 30, 150, false, 36),
  ('LASER policzki M', 'M', 30, 300, false, 37),
  ('LASER pośladki K', 'K', 45, 300, false, 38),
  ('LASER pośladki M', 'M', 60, 400, false, 39),
  ('LASER przedramiona K', 'K', 60, 320, false, 40),
  ('LASER przedramiona M', 'M', 60, 400, false, 41),
  ('LASER ramiona K', 'K', 90, 280, false, 42),
  ('LASER ramiona M', 'M', 60, 320, false, 43),
  ('LASER stopy K', 'K', 30, 50, false, 44),
  ('LASER stopy M', 'M', 30, 95, false, 45),
  ('LASER szyja K', 'K', 30, 200, false, 46),
  ('LASER szyja M', 'M', 30, 350, false, 47),
  ('LASER uda K', 'K', 120, 450, false, 48),
  ('LASER uda M', 'M', 210, 680, false, 49),
  ('LASER uszy K', 'K', 30, 120, false, 50),
  ('LASER uszy M', 'M', 30, 190, false, 51),
  ('znieczulenie ciało', 'K', 75, 80, true, 52);

-- dodaj brakujące
insert into services (category_id, name, duration_minutes, price, price_from, sort_order, active)
select (select id from service_categories where name =
          case l.g when 'K' then 'Depilacja laserowa dla K'
                   when 'M' then 'Depilacja laserowa dla M'
                   else 'Depilacja laserowa' end),
       l.name, l.mins, l.price, l.price_from, 1000 + l.ord, true
from _laser l
where not exists (select 1 from services s where lower(s.name) = lower(l.name));

-- włącz, jeśli były ukryte
update services s set active = true from _laser l where lower(s.name) = lower(l.name);

-- pracownice i gabinet Laser
insert into staff_services (staff_id, service_id)
select st.id, s.id from staff st join services s on true join _laser l on lower(s.name) = lower(l.name)
where st.active
on conflict do nothing;
insert into service_rooms (service_id, room_id)
select s.id, r.id from services s join _laser l on lower(s.name) = lower(l.name)
join rooms r on r.name = 'Laser'
where s.name ilike 'laser %'
on conflict do nothing;

commit;

-- Sprawdzenie
select c.name as kategoria, count(s.id) as zabiegow
from service_categories c left join services s on s.category_id = c.id and s.active
where c.name like 'Depilacja laserowa%'
group by c.name order by c.name;

