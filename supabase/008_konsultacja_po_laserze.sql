-- Dodaje brakujący zabieg: konsultacja po zabiegu laserem (15 min, 0 zł)
-- w kategorii "Depilacja laserowa". Można uruchomić ponownie.
insert into services (category_id, name, duration_minutes, price, sort_order)
select c.id, 'konsultacja po zabiegu laserem', 15, 0,
       (select coalesce(min(s.sort_order), 0) - 1 from services s
        join service_categories k on k.id = s.category_id
        where k.name in ('Depilacja laserowa dla M', 'Depilacja laserowa dla K'))
from service_categories c
where c.name = 'Depilacja laserowa'
  and not exists (select 1 from services where name = 'konsultacja po zabiegu laserem');

-- wszystkie aktywne pracownice mogą ją wykonywać
insert into staff_services (staff_id, service_id)
select st.id, s.id from staff st cross join services s
where s.name = 'konsultacja po zabiegu laserem' and st.active
on conflict do nothing;

select name, duration_minutes, price from services where name = 'konsultacja po zabiegu laserem';
