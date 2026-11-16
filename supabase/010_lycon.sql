-- =====================================================================
--  DEPILACJA WOSKIEM LYCON – 21 zabiegów (z Versum).
--  Dodaje brakujące, istniejące zostawia. Można uruchomić ponownie.
-- =====================================================================
begin;

insert into service_categories (name, sort_order) values ('Depilacja woskiem Lycon', 70)
on conflict (name) do nothing;

create temp table _lycon(name text, mins int, price numeric, price_from boolean, ord int) on commit drop;
insert into _lycon values
  ('LYCON baki', 20, 50, false, 0),
  ('LYCON bikini brazylijskie', 45, 150, false, 1),
  ('LYCON bikini klasyczne', 30, 80, false, 2),
  ('LYCON BOYZYLIAN depilacja męska intymna', 60, 300, true, 3),
  ('LYCON broda', 15, 50, false, 4),
  ('Lycon brwi', 15, 45, false, 5),
  ('LYCON brzuch', 30, 50, false, 6),
  ('LYCON całe nogi', 60, 170, false, 7),
  ('LYCON całe ręce', 30, 80, false, 8),
  ('LYCON górna warga', 10, 45, false, 9),
  ('LYCON kark', 30, 50, false, 10),
  ('LYCON łydki', 30, 80, false, 11),
  ('LYCON nos', 15, 35, false, 12),
  ('LYCON pachy', 30, 80, false, 13),
  ('LYCON plecy', 45, 150, false, 14),
  ('Lycon pomiędzy pośladkami', 30, 100, false, 15),
  ('LYCON pośladki', 30, 120, false, 16),
  ('LYCON przedramiona', 15, 60, false, 17),
  ('LYCON tors', 15, 80, false, 18),
  ('LYCON uda', 40, 100, false, 19),
  ('LYCON uszy', 15, 25, false, 20);

insert into services (category_id, name, duration_minutes, price, price_from, sort_order, active)
select (select id from service_categories where name = 'Depilacja woskiem Lycon'),
       l.name, l.mins, l.price, l.price_from, 2000 + l.ord, true
from _lycon l
where not exists (select 1 from services s where lower(s.name) = lower(l.name));

-- kolejność alfabetyczna jak w Versum, ukryte włączamy
update services s set sort_order = 2000 + l.ord, active = true
from _lycon l where lower(s.name) = lower(l.name);

insert into staff_services (staff_id, service_id)
select st.id, s.id from staff st join services s on true join _lycon l on lower(s.name) = lower(l.name)
where st.active
on conflict do nothing;

commit;

select count(*) as zabiegi_lycon from services s
join service_categories c on c.id = s.category_id
where c.name = 'Depilacja woskiem Lycon' and s.active;

