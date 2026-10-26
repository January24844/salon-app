-- =====================================================================
--  AKTUALIZACJA 002 – wizyty z kilkoma usługami, pakiety, grafik dzienny,
--  przedpłaty, etykiety + zabiegi i pracownice salonu.
--  Uruchom RAZ w Supabase → SQL Editor (po schema.sql).
-- =====================================================================

-- ---------- Kategorie: podkategorie (np. Kosmetyka → Zabiegi na twarz)
alter table service_categories add column if not exists parent_id uuid
  references service_categories(id) on delete cascade;

-- ---------- Zabiegi: pakiety (np. "pakiet 3 zabiegów" = 3 wizyty)
alter table services add column if not exists package_sessions int not null default 1
  check (package_sessions >= 1);

-- ---------- Grafik na konkretny dzień (jak w Versum: "17:00 - 21:00" / "dzień wolny")
-- Jeśli dla danego dnia jest wpis – ma pierwszeństwo przed stałym grafikiem tygodniowym.
create table if not exists staff_schedule_days (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff(id) on delete cascade,
  day        date not null,
  is_day_off boolean not null default false,
  start_time time,
  end_time   time,
  note       text,
  unique (staff_id, day),
  check (is_day_off or (start_time is not null and end_time is not null and end_time > start_time))
);

-- ---------- Wiersz "dzień" w kalendarzu – notatki na cały dzień
create table if not exists calendar_day_notes (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  staff_id   uuid references staff(id) on delete cascade,  -- null = dla całego salonu
  text       text not null,
  created_at timestamptz not null default now()
);

-- ---------- Wizyta może mieć kilka usług
create table if not exists appointment_services (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null references appointments(id) on delete cascade,
  service_id       uuid not null references services(id) on delete restrict,
  position         int not null default 0,
  duration_minutes int not null check (duration_minutes > 0),
  price            numeric(10,2) not null default 0,
  client_package_id uuid,   -- jeśli rozliczona z karnetu/pakietu
  created_at       timestamptz not null default now()
);
create index if not exists appointment_services_appt_idx on appointment_services (appointment_id);

-- usługa przenosi się z wizyty do listy usług wizyty (baza jest pusta, nic nie ginie)
alter table appointments drop column if exists service_id;

-- ---------- Przedpłata
alter table appointments add column if not exists deposit_amount numeric(10,2);
alter table appointments add column if not exists deposit_method text
  check (deposit_method in ('gotowka', 'karta', 'przelew', 'blik', 'online'));
alter table appointments add column if not exists deposit_paid_at timestamptz;

-- ---------- Etykiety wizyt (np. VIP, pierwsza wizyta, do potwierdzenia)
create table if not exists labels (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  color text not null default '#B5838D'
);
create table if not exists appointment_labels (
  appointment_id uuid not null references appointments(id) on delete cascade,
  label_id       uuid not null references labels(id) on delete cascade,
  primary key (appointment_id, label_id)
);

-- ---------- Karnety / pakiety kupione przez klientkę
create table if not exists client_packages (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  service_id     uuid not null references services(id) on delete restrict,
  sessions_total int not null check (sessions_total >= 1),
  price_paid     numeric(10,2),
  purchased_at   date not null default current_date,
  valid_until    date,
  note           text,
  created_at     timestamptz not null default now()
);
do $$ begin
  alter table appointment_services add constraint appointment_services_package_fk
    foreign key (client_package_id) references client_packages(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ile wizyt z karnetu zostało
create or replace view client_packages_status with (security_invoker = true) as
select p.*,
       count(a.id) filter (where ap.status not in ('cancelled', 'no_show')) as sessions_used,
       p.sessions_total - count(a.id) filter (where ap.status not in ('cancelled', 'no_show')) as sessions_left
from client_packages p
left join appointment_services a on a.client_package_id = p.id
left join appointments ap on ap.id = a.appointment_id
group by p.id;

-- ---------- Bezpieczeństwo nowych tabel
alter table staff_schedule_days  enable row level security;
alter table calendar_day_notes   enable row level security;
alter table appointment_services enable row level security;
alter table labels               enable row level security;
alter table appointment_labels   enable row level security;
alter table client_packages      enable row level security;

drop policy if exists "team all" on staff_schedule_days;
drop policy if exists "public read" on staff_schedule_days;
drop policy if exists "team all" on calendar_day_notes;
drop policy if exists "team all" on appointment_services;
drop policy if exists "client own" on appointment_services;
drop policy if exists "team all" on labels;
drop policy if exists "team all" on appointment_labels;
drop policy if exists "team all" on client_packages;
drop policy if exists "client own" on client_packages;

create policy "team all" on staff_schedule_days  for all using (is_team()) with check (is_team());
create policy "public read" on staff_schedule_days for select using (true);  -- potrzebne do wolnych terminów online
create policy "team all" on calendar_day_notes   for all using (is_team()) with check (is_team());
create policy "team all" on appointment_services for all using (is_team()) with check (is_team());
create policy "team all" on labels               for all using (is_team()) with check (is_team());
create policy "team all" on appointment_labels   for all using (is_team()) with check (is_team());
create policy "team all" on client_packages      for all using (is_team()) with check (is_team());
create policy "client own" on appointment_services for select using (
  appointment_id in (select a.id from appointments a join clients c on c.id = a.client_id
                     where c.profile_id = auth.uid()));
create policy "client own" on client_packages for select using (
  client_id in (select id from clients where profile_id = auth.uid()));

-- =====================================================================
--  DANE SALONU
-- =====================================================================
delete from service_categories where name in ('Twarz', 'Rzęsy i brwi', 'Dłonie i stopy')
  and not exists (select 1 from services s where s.category_id = service_categories.id);

insert into labels (name, color) values
  ('Pierwsza wizyta', '#7FB3D5'), ('VIP', '#D4AC0D'),
  ('Do potwierdzenia', '#E59866'), ('Konsultacja', '#A9CCE3')
on conflict (name) do nothing;

-- Pracownice (ze zrzutu z Versum). Godziny pracy ustawisz w aplikacji.
insert into staff (full_name, color, sort_order)
select v.name, v.color, v.ord from (values
  ('Aleksandra W', '#F4A7B9', 1),
  ('Beata J',      '#C5E0A5', 2),
  ('Anna W',       '#A8D4F5', 3),
  ('Blanka B',     '#8DB86B', 4),
  ('Anna Sz',      '#FFE89A', 5)
) as v(name, color, ord)
where not exists (select 1 from staff s where s.full_name = v.name);

-- Kategorie zabiegów
insert into service_categories (name, parent_id, sort_order) values ('Kosmetyka', null, 0) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Zabiegi na twarz', (select id from service_categories where name = 'Kosmetyka'), 1) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Zabiegi na ciało', (select id from service_categories where name = 'Kosmetyka'), 2) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Usuwanie zmian skórnych', (select id from service_categories where name = 'Kosmetyka'), 3) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Stylizacja brwi i rzęs', null, 4) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Medycyna estetyczna', null, 5) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Depilacja laserowa', null, 6) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Depilacja laserowa dla M', (select id from service_categories where name = 'Depilacja laserowa'), 7) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Depilacja laserowa dla K', (select id from service_categories where name = 'Depilacja laserowa'), 8) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Depilacja woskiem Lycon', null, 9) on conflict (name) do nothing;
insert into service_categories (name, parent_id, sort_order) values ('Endermologia LPG', null, 10) on conflict (name) do nothing;

-- Zabiegi (cennik salonu)
insert into services (category_id, name, duration_minutes, price, package_sessions, sort_order)
select c.id, v.name, v.mins, v.price, v.sess, v.ord from (values
  ('Zabiegi na twarz', 'Bioline, Lifting Code - zabieg liftingujący z płatem kolagenowym', 90, 420.00, 1, 0),
  ('Zabiegi na twarz', 'Dermapen 4 - twarz, ampułka DP Derm', 45, 800.00, 1, 1),
  ('Zabiegi na twarz', 'Dermapen 4 - twarz, pakiet 3-ch zabiegów, ampułka DP Derm', 45, 2100.00, 3, 2),
  ('Zabiegi na twarz', 'Dermapen 4 - twarz, szyja, ampułka DP Derm', 60, 1000.00, 1, 3),
  ('Zabiegi na twarz', 'Dermapen 4 - twarz, szyja, dekolt, ampułka DP Derm', 90, 1150.00, 1, 4),
  ('Zabiegi na twarz', 'Dermapen 4, DP Derm, Uber Pro peel - kwas po zabiegu Dermapen', 5, 100.00, 1, 5),
  ('Zabiegi na twarz', 'Dermapen 4™ + ampułka DP Derm', 45, 700.00, 1, 6),
  ('Zabiegi na twarz', 'Dives, GLOW X9 peeling + GLOW COLD MASK', 50, 420.00, 1, 7),
  ('Zabiegi na twarz', 'Dives, GLOW X9 z mikronakłuwaniem i ampułką', 60, 630.00, 1, 8),
  ('Zabiegi na twarz', 'Epicuren, Signature Facial - zabieg flagowy anti aging', 90, 390.00, 1, 9),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - OXY Geneo+ - Cała twarz', 40, 450.00, 1, 10),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - OXY Geneo+ - Twarz, szyja, dekolt', 50, 500.00, 1, 11),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - OXY Geneo+ - Pakiet 3-ch zabiegów (twarz)', 40, 1200.00, 3, 12),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - OXY Geneo+ - Pakiet 3-ch zabiegów (twarz, szyja, dekolt)', 50, 1350.00, 3, 13),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ - Cała twarz', 50, 550.00, 1, 14),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ - Twarz, szyja, dekolt', 60, 590.00, 1, 15),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ - Pakiet 3-ch zabiegów (twarz)', 50, 1500.00, 3, 16),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ - Pakiet 3-ch zabiegów (twarz, szyja, dekolt)', 60, 1650.00, 3, 17),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ & Ultradźwięki - Cała twarz', 60, 590.00, 1, 18),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ & Ultradźwięki - Twarz, szyja, dekolt', 75, 650.00, 1, 19),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ & Ultradźwięki - Pakiet 3-ch zabiegów (twarz)', 60, 1620.00, 3, 20),
  ('Zabiegi na twarz', 'Geneo+ by Pollogen - Tripollar RF & OXY Geneo+ & Ultradźwięki - Pakiet 3-ch zabiegów (twarz, szyja, dekolt)', 75, 1800.00, 3, 21),
  ('Zabiegi na twarz', 'Intraceuticals, infuzja tlenowa z ampułką REJUVENATE, z kwasem hialuronowym', 60, 490.00, 1, 22),
  ('Zabiegi na twarz', 'Is Clinical Fiszz facial - zabieg złuszczająco-nawilżający', 60, 280.00, 1, 23),
  ('Zabiegi na twarz', 'konsultacja kosmetologiczna', 15, 0.00, 1, 24),
  ('Zabiegi na twarz', 'Kwasy na twarz (dobór indywidualny)', 45, 200.00, 1, 25),
  ('Zabiegi na twarz', 'M-pen, mikronakłuwanie z indywidualnie dobraną ampułką np. RETIX C Pepti-Hyal', 60, 450.00, 1, 26),
  ('Zabiegi na twarz', 'Masaż KOBIDO, japoński lifting twarzy', 60, 250.00, 1, 27),
  ('Zabiegi na twarz', 'Masaż KOBIDO, pakiet 5 masaży', 60, 1125.00, 5, 28),
  ('Zabiegi na twarz', 'Masaż twarzy', 30, 140.00, 1, 29),
  ('Zabiegi na twarz', 'Mesoestetic Global eyecon - zabieg liftingujący', 45, 340.00, 1, 30),
  ('Zabiegi na twarz', 'Mesoestetic, Mesoeclat - pakiet 3 zabiegów', 60, 1190.00, 3, 31),
  ('Zabiegi na twarz', 'Mesoestetic, Mesoeclat - pakiet 6 zabiegów', 60, 2390.00, 6, 32),
  ('Zabiegi na twarz', 'Mesoestetic, Mesoéclat całoroczny zabieg anti-aging', 60, 420.00, 1, 33),
  ('Zabiegi na twarz', 'MiraRollers', 60, 450.00, 1, 34),
  ('Zabiegi na twarz', 'PQAge peeling anti aging (bankietowy)', 60, 400.00, 1, 35),
  ('Zabiegi na twarz', 'Red Carpet Facial', 60, 360.00, 1, 36),
  ('Zabiegi na twarz', 'Repechage 4-layer facial - zabieg anti aging', 90, 380.00, 1, 37),
  ('Zabiegi na twarz', 'Repechage Hydra medic - zabieg oczyszczający', 90, 310.00, 1, 38),
  ('Zabiegi na twarz', 'Repechage, Hydra 4 Red-Out - zabieg wyciszająco-nawilżający do cery wrażliwej/z trądzikiem różowatym', 75, 380.00, 1, 39),
  ('Zabiegi na twarz', 'Repechage, Opti-Firm - zabieg na okolicę oka', 35, 180.00, 1, 40),
  ('Zabiegi na twarz', 'Retix C Eye zabieg rozjaśniający na okolicę oczu - Okolica oczu', 40, 230.00, 1, 41),
  ('Zabiegi na twarz', 'Retix C Eye zabieg rozjaśniający na okolicę oczu - Cała twarz', 55, 320.00, 1, 42),
  ('Zabiegi na twarz', 'Retix C Eye zabieg rozjaśniający na okolicę oczu - Retix C Eye z mikronakłuwaniem', 60, 330.00, 1, 43),
  ('Zabiegi na twarz', 'Retix C Eye zabieg rozjaśniający na okolicę oczu - Retix C Eye z mikronakłuwaniem, cała twarz', 70, 430.00, 1, 44),
  ('Zabiegi na twarz', 'Retix C French Touch - Twarz, szyja, dekolt', 45, 320.00, 1, 45),
  ('Zabiegi na twarz', 'Retix C French Touch - French Touch, Crystal Fiber mask', 60, 370.00, 1, 46),
  ('Zabiegi na twarz', 'Retix C French Touch - French Touch, microneedling, Crystal Fiber Mask', 60, 450.00, 1, 47),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Peeling Retiskin przed zabiegiem', 55, 480.00, 1, 48),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Twarz, szyja, dekolt', 40, 410.00, 1, 49),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Retibooster, Microneedling', 75, 490.00, 1, 50),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Retibooster, Microneedling, Crystal Fiber mask', 75, 530.00, 1, 51),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Peel Retiskin, Retibooster, Microneedling, Crystal fiber mask', 90, 610.00, 1, 52),
  ('Zabiegi na twarz', 'Retix C Retibooster (twarz, szyja, dekolt) - Peel Retiskin, Retibooster, Microneedling', 75, 570.00, 1, 53),
  ('Zabiegi na twarz', 'Retix C Retiglow - Twarz, szyja, dekolt', 45, 310.00, 1, 54),
  ('Zabiegi na twarz', 'Retix C Retiglow - Retiglow, Crystal Fiber mask', 60, 360.00, 1, 55),
  ('Zabiegi na twarz', 'Retix C zabieg rozjaśniający z retinolem', 45, 280.00, 1, 56),
  ('Zabiegi na twarz', 'Retix, Revive CT peel - mieszanka kwasów z maską retinolową i vit C', 40, 390.00, 1, 57),
  ('Zabiegi na twarz', 'Retix, Revive CT peel - mieszanka kwasów z maską retinolową i vit C + mikronakłuwanie', 60, 490.00, 1, 58),
  ('Zabiegi na twarz', 'Silk peel mikrodermabrazja z infuzją, Hydramikrodermabrazja plus maska - twarz', 60, 310.00, 1, 59),
  ('Zabiegi na twarz', 'Silk peel mikrodermabrazja z infuzją, Hydramikrodermabrazja plus maska, twarz+szyja+dekolt', 60, 350.00, 1, 60),
  ('Zabiegi na twarz', 'SMART DNA therapy RETIX C', 75, 550.00, 1, 61),
  ('Zabiegi na twarz', 'SMART DNA therapy RETIX C - pakiet 3 zabiegów', 90, 1600.00, 3, 62),
  ('Zabiegi na twarz', 'Tox peel zabieg anti aging', 60, 240.00, 1, 63),
  ('Zabiegi na twarz', 'Zabieg na twarz, dobór indywidualny', 90, 260.00, 1, 64),
  ('Zabiegi na twarz', 'Zaproszenie', 5, 1.00, 1, 65),
  ('Zabiegi na twarz', 'znieczulenie twarz', 40, 60.00, 1, 66),
  ('Zabiegi na ciało', 'Masaż ciała', 60, 240.00, 1, 67),
  ('Zabiegi na ciało', 'Masaż pleców', 30, 120.00, 1, 68),
  ('Zabiegi na ciało', 'Oczyszczanie pleców', 60, 250.00, 1, 69),
  ('Zabiegi na ciało', 'Peeling ciała - peeling cukrowy epicuren Cinnamon, Vanilla Brown Sugar Polish, olejek/balsam', 60, 150.00, 1, 70),
  ('Zabiegi na ciało', 'Terapia Access Bars', 60, 210.00, 1, 71),
  ('Zabiegi na ciało', 'Vaggegi, Bandaże antycellulitowe rozgrzewające', 30, 200.00, 1, 72),
  ('Usuwanie zmian skórnych', 'Brodawka łojotokowa', 30, 100.00, 1, 73),
  ('Usuwanie zmian skórnych', 'Elektroliza', 30, 0.00, 1, 74),
  ('Usuwanie zmian skórnych', 'Naczyniak (rubinowy)', 30, 80.00, 1, 75),
  ('Usuwanie zmian skórnych', 'Rozszerzone naczynka - cały nos', 30, 300.00, 1, 76),
  ('Usuwanie zmian skórnych', 'Rozszerzone naczynka - skrzydełka nosa', 30, 200.00, 1, 77),
  ('Usuwanie zmian skórnych', 'Włókniak', 30, 100.00, 1, 78),
  ('Usuwanie zmian skórnych', 'Znamię', 30, 100.00, 1, 79),
  ('Usuwanie zmian skórnych', 'znieczulenie (1 ampułka)', 5, 80.00, 1, 80),
  ('Stylizacja brwi i rzęs', 'Henna brwi plus regulacja Lycon', 30, 80.00, 1, 81),
  ('Stylizacja brwi i rzęs', 'Henna brwi plus regulacja pęsetą', 30, 80.00, 1, 82),
  ('Stylizacja brwi i rzęs', 'Henna komplet + regulacja Lycon (brwi+rzęsy)', 45, 110.00, 1, 83),
  ('Stylizacja brwi i rzęs', 'Henna komplet + regulacja pęsetą (brwi + rzęsy)', 45, 110.00, 1, 84),
  ('Stylizacja brwi i rzęs', 'Henna pudrowa, stylizacja, geometria, koloryzacja', 55, 120.00, 1, 85),
  ('Stylizacja brwi i rzęs', 'Henna rzęs', 30, 60.00, 1, 86),
  ('Stylizacja brwi i rzęs', 'Laminacja brwi (laminacja, farbka, regeneracja)', 45, 200.00, 1, 87),
  ('Stylizacja brwi i rzęs', 'Laminacja brwi z regulacją Lycon (laminacja, farbka, regeneracja, geometria, wosk)', 60, 230.00, 1, 88),
  ('Stylizacja brwi i rzęs', 'Lifting rzęs (botox, keratyna, farbka)', 60, 200.00, 1, 89),
  ('Stylizacja brwi i rzęs', 'Lifting rzęs + laminacja brwi + farbka', 120, 370.00, 1, 90),
  ('Stylizacja brwi i rzęs', 'Regulacja brwi woskiem LYCON', 20, 45.00, 1, 91),
  ('Stylizacja brwi i rzęs', 'Regulacja pęsetą', 20, 40.00, 1, 92),
  ('Stylizacja brwi i rzęs', 'Zagęszczanie / przedłużanie rzęs', 140, 250.00, 1, 93),
  ('Medycyna estetyczna', 'Dr Cyj, Mezoterapia skóry głowy - kuracja zagęszczająca włosy', 30, 700.00, 1, 94),
  ('Medycyna estetyczna', 'Dr Cyj, Mezoterapia skóry głowy - kuracja zagęszczająca włosy, zapobiegająca wypadaniu włosów - pakiet 4 zabiegów', 45, 2400.00, 4, 95),
  ('Medycyna estetyczna', 'Lipoliza iniekcyjna, likwidacja komórek tłuszczowych (Aqualyx, Lipolax, Dermaheal LL)', 30, 400.00, 1, 96),
  ('Medycyna estetyczna', 'Medycyna estetyczna', 15, 350.00, 1, 97),
  ('Medycyna estetyczna', 'Mesoestetic, Cosmelan/Dermamelan - zabieg likwidujący przebarwienia', 60, 1800.00, 1, 98),
  ('Medycyna estetyczna', 'Mezoterapia igłowa, twarz/szyja/dekolt/dłonie (Fillmed NCTF 135 HA)', 60, 450.00, 1, 99),
  ('Medycyna estetyczna', 'Mezoterapia okolicy oczu - Light Eyes Ultra, rozjaśnienie, likwidacja cieni i zastojów limfatycznych, nawilżenie', 50, 400.00, 1, 100),
  ('Medycyna estetyczna', 'Mezoterapia okolicy oczu Light Eyes Ultra - pakiet 3 zabiegów', 50, 1050.00, 3, 101),
  ('Medycyna estetyczna', 'Mezoterapia Skinbooster - mezoterapia głęboka twarzy/ szyi, dekoltu/ dłoni (kwasem hialuronowym Restylane Skinbooster Vital)', 30, 750.00, 1, 102),
  ('Medycyna estetyczna', 'Mezoterapia Skinbooster, mezoterapia głęboka twarzy, okolicy oczu/ szyi, dekoltu (kwasem hialuronowym Restylane Skinbooster Vital Light)', 30, 700.00, 1, 103),
  ('Medycyna estetyczna', 'Stymulatory tkankowe, stymulacja syntezy kolagenu i elastyny (Nucleofil)', 30, 1000.00, 1, 104),
  ('Medycyna estetyczna', 'Stymulatory tkankowe, stymulacja syntezy kolagenu i elastyny (Profhilo)', 30, 1200.00, 1, 105),
  ('Medycyna estetyczna', 'Wypełnianie zmarszczek kwasem hialuronowym, bruzdy nosowo-wargowe/ głębokie zmarszczki (Restylane Refyne/Defyne)', 30, 900.00, 1, 106),
  ('Depilacja laserowa dla M', 'LASER baki M', 30, 300.00, 1, 107),
  ('Depilacja laserowa dla M', 'LASER broda M', 30, 350.00, 1, 108),
  ('Depilacja laserowa dla M', 'LASER brzuch M', 60, 360.00, 1, 109),
  ('Depilacja laserowa dla M', 'LASER całe nogi M', 180, 1040.00, 1, 110),
  ('Depilacja laserowa dla M', 'LASER dłonie M', 30, 200.00, 1, 111),
  ('Depilacja laserowa dla M', 'LASER górna warga M', 30, 240.00, 1, 112),
  ('Depilacja laserowa dla M', 'LASER kark M', 60, 400.00, 1, 113),
  ('Depilacja laserowa dla M', 'LASER klatka piersiowa M', 60, 360.00, 1, 114),
  ('Depilacja laserowa dla M', 'LASER kolana M', 45, 120.00, 1, 115),
  ('Depilacja laserowa dla M', 'LASER linia włosów M', 30, 300.00, 1, 116),
  ('Depilacja laserowa dla M', 'LASER łydki M', 120, 560.00, 1, 117),
  ('Depilacja laserowa dla M', 'LASER między brwiami M', 20, 200.00, 1, 118),
  ('Depilacja laserowa dla M', 'Laser między pośladkami M', 45, 230.00, 1, 119),
  ('Depilacja laserowa dla M', 'LASER pachy M', 60, 300.00, 1, 120),
  ('Depilacja laserowa dla M', 'LASER plecy M', 120, 700.00, 1, 121),
  ('Depilacja laserowa dla M', 'LASER policzki M', 30, 300.00, 1, 122),
  ('Depilacja laserowa dla M', 'LASER pośladki M', 60, 400.00, 1, 123),
  ('Depilacja laserowa dla M', 'LASER przedramiona M', 60, 400.00, 1, 124),
  ('Depilacja laserowa dla M', 'LASER ramiona M', 60, 320.00, 1, 125),
  ('Depilacja laserowa dla M', 'LASER stopy M', 30, 95.00, 1, 126),
  ('Depilacja laserowa dla M', 'LASER szyja M', 30, 350.00, 1, 127),
  ('Depilacja laserowa dla M', 'LASER uda M', 210, 680.00, 1, 128),
  ('Depilacja laserowa dla M', 'LASER uszy M', 30, 190.00, 1, 129),
  ('Depilacja laserowa dla K', 'LASER klatka piersiowa K', 45, 320.00, 1, 130),
  ('Depilacja laserowa dla K', 'LASER baki K', 30, 200.00, 1, 131),
  ('Depilacja laserowa dla K', 'LASER bikini głębokie K', 80, 400.00, 1, 132),
  ('Depilacja laserowa dla K', 'LASER bikini podstawowe K', 45, 300.00, 1, 133),
  ('Depilacja laserowa dla K', 'LASER broda K', 30, 200.00, 1, 134),
  ('Depilacja laserowa dla K', 'LASER brodawki K', 30, 160.00, 1, 135),
  ('Depilacja laserowa dla K', 'LASER brzuch K', 45, 300.00, 1, 136),
  ('Depilacja laserowa dla K', 'LASER całe nogi K', 150, 850.00, 1, 137),
  ('Depilacja laserowa dla K', 'LASER dłonie K', 30, 100.00, 1, 138),
  ('Depilacja laserowa dla K', 'LASER górna warga K', 15, 150.00, 1, 139),
  ('Depilacja laserowa dla K', 'LASER kark K', 30, 200.00, 1, 140),
  ('Depilacja laserowa dla K', 'LASER kolana K', 30, 80.00, 1, 141),
  ('Depilacja laserowa dla K', 'LASER konsultacja i próba', 30, 0.00, 1, 142),
  ('Depilacja laserowa dla K', 'LASER lędźwia K', 60, 320.00, 1, 143),
  ('Depilacja laserowa dla K', 'LASER linia biała K', 30, 150.00, 1, 144),
  ('Depilacja laserowa dla K', 'LASER linia włosów K', 30, 250.00, 1, 145),
  ('Depilacja laserowa dla K', 'LASER łydki K', 80, 400.00, 1, 146),
  ('Depilacja laserowa dla K', 'LASER między brwiami K', 20, 150.00, 1, 147),
  ('Depilacja laserowa dla K', 'Laser między pośladkami K', 30, 160.00, 1, 148),
  ('Depilacja laserowa dla K', 'LASER pachy K', 30, 250.00, 1, 149),
  ('Depilacja laserowa dla K', 'LASER policzki', 30, 150.00, 1, 150),
  ('Depilacja laserowa dla K', 'LASER pośladki K', 45, 300.00, 1, 151),
  ('Depilacja laserowa dla K', 'LASER przedramiona K', 60, 320.00, 1, 152),
  ('Depilacja laserowa dla K', 'LASER ramiona K', 90, 280.00, 1, 153),
  ('Depilacja laserowa dla K', 'LASER stopy K', 30, 50.00, 1, 154),
  ('Depilacja laserowa dla K', 'LASER szyja K', 30, 200.00, 1, 155),
  ('Depilacja laserowa dla K', 'LASER uda K', 120, 450.00, 1, 156),
  ('Depilacja laserowa dla K', 'LASER uszy K', 30, 120.00, 1, 157),
  ('Depilacja laserowa dla K', 'znieczulenie ciało', 75, 80.00, 1, 158),
  ('Depilacja woskiem Lycon', 'LYCON uszy', 15, 25.00, 1, 159),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 10 minut - 1 zabieg', 10, 80.00, 1, 160),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 10 minut - 6 zabiegów', 10, 420.00, 6, 161),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 10 minut - 12 zabiegów', 10, 800.00, 12, 162),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 20 minut - 1 zabieg', 20, 140.00, 1, 163),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 20 minut - 6 zabiegów', 20, 740.00, 6, 164),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 20 minut - 12 zabiegów', 20, 1360.00, 12, 165),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30 minut - 1 zabieg', 30, 180.00, 1, 166),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30 minut - 6 zabiegów', 30, 960.00, 6, 167),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30 minut - 12 zabiegów', 30, 1800.00, 12, 168),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30''+10'' - 1 zabieg', 40, 210.00, 1, 169),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30''+10'' - 6 zabiegów', 40, 1100.00, 6, 170),
  ('Endermologia LPG', 'Endermolift LPG Alliance/Integral twarz - 30''+10'' - 12 zabiegów', 40, 2000.00, 12, 171),
  ('Endermologia LPG', 'Endermologia LPG - 20 minut Focus express', 20, 90.00, 1, 172),
  ('Endermologia LPG', 'Endermologia LPG - 40 minut 1 zabieg', 45, 200.00, 1, 173),
  ('Endermologia LPG', 'Endermologia LPG - 40 minut pakiet 10 zabiegów', 45, 1800.00, 10, 174),
  ('Endermologia LPG', 'Endermologia LPG - 40 minut pakiet 15 zabiegów', 45, 2500.00, 15, 175),
  ('Endermologia LPG', 'Endermologia LPG - 40 minut pakiet 20 zabiegów', 45, 3200.00, 20, 176)
) as v(cat, name, mins, price, sess, ord)
join service_categories c on c.name = v.cat
where not exists (select 1 from services s where s.name = v.name);

-- Na start każda pracownica może wykonywać każdy zabieg – odznaczysz w aplikacji.
insert into staff_services (staff_id, service_id)
select st.id, s.id from staff st cross join services s
on conflict do nothing;

