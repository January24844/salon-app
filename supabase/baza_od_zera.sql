-- =====================================================================
--  SALON – cała baza od zera (struktura + zabiegi + pracownice)
--  Nowy projekt Supabase → SQL Editor → wklej całość → Run.
-- =====================================================================

create extension if not exists btree_gist;   -- blokada nakładających się wizyt

-- ---------- Typy ----------------------------------------------------
do $$ begin
  create type user_role as enum ('owner', 'staff', 'client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_status as enum
    ('booked', 'confirmed', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_channel as enum ('sms', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  -- kiedy wysłać wiadomość względem wizyty
  create type message_trigger as enum (
    'on_booking',        -- zaraz po zarezerwowaniu
    'before_start',      -- X godzin przed wizytą (przypomnienie, przygotowanie)
    'after_end',         -- X godzin po wizycie (zalecenia pozabiegowe)
    'rebook',            -- X dni po wizycie (zaproszenie na kolejny zabieg)
    'on_cancel'          -- po odwołaniu
  );
exception when duplicate_object then null; end $$;

-- ---------- Ustawienia salonu --------------------------------------
create table if not exists salon_settings (
  id              int primary key default 1 check (id = 1),  -- jeden wiersz
  name            text not null default 'Mój Salon',
  phone           text,
  email           text,
  address         text,
  timezone        text not null default 'Europe/Warsaw',
  booking_slot_minutes int not null default 15,   -- co ile minut pokazywać godziny
  min_notice_hours     int not null default 2,    -- min. wyprzedzenie rezerwacji online
  cancel_notice_hours  int not null default 24,   -- do kiedy klientka sama odwoła
  sms_sender_name text,                            -- nadawca SMS, np. "MojSalon"
  updated_at      timestamptz not null default now()
);
insert into salon_settings (id) values (1) on conflict do nothing;

-- ---------- Użytkownicy (profil do konta logowania) -----------------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'client',
  full_name  text,
  phone      text,
  created_at timestamptz not null default now()
);

-- ---------- Pracownice i gabinety -----------------------------------
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid unique references profiles(id) on delete set null,
  full_name   text not null,
  color       text not null default '#E8A0BF',   -- kolor w kalendarzu
  phone       text,
  email       text,
  bookable_online boolean not null default true,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,              -- np. "Gabinet 1", "Pokój laserowy"
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- godziny pracy (stały grafik tygodniowy)
create table if not exists staff_working_hours (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),  -- 1 = pon
  start_time time not null,
  end_time   time not null check (end_time > start_time)
);

-- urlopy, choroba, przerwy, zmiany grafiku w konkretny dzień
create table if not exists staff_time_off (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid not null references staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null check (ends_at > starts_at),
  reason    text
);

-- ---------- Zabiegi -------------------------------------------------
create table if not exists service_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,      -- np. "Kosmetyka", "Zabiegi na twarz"
  parent_id  uuid references service_categories(id) on delete cascade,  -- podkategoria
  sort_order int not null default 0
);

create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  category_id      uuid references service_categories(id) on delete set null,
  name             text not null,
  description      text,                -- opis widoczny dla klientki
  duration_minutes int not null check (duration_minutes > 0),
  buffer_minutes   int not null default 0,   -- sprzątanie / przygotowanie po zabiegu
  price            numeric(10,2) not null default 0,
  price_from       boolean not null default false,  -- "od 150 zł"
  room_required    boolean not null default false,
  package_sessions int not null default 1 check (package_sessions >= 1),  -- pakiet = ile wizyt
  rebook_after_days int,                -- po ilu dniach zaprosić ponownie
  bookable_online  boolean not null default true,
  active           boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

-- która pracownica wykonuje który zabieg
create table if not exists staff_services (
  staff_id   uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

-- które gabinety nadają się do zabiegu
create table if not exists service_rooms (
  service_id uuid not null references services(id) on delete cascade,
  room_id    uuid not null references rooms(id) on delete cascade,
  primary key (service_id, room_id)
);

-- ---------- Klientki ------------------------------------------------
create table if not exists clients (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid unique references profiles(id) on delete set null, -- jeśli ma konto
  first_name   text not null,
  last_name    text,
  phone        text,
  email        text,
  birth_date   date,
  notes        text,                    -- notatki salonu (klientka nie widzi)
  allergies    text,                    -- przeciwwskazania / alergie
  -- zgody RODO
  consent_reminders  boolean not null default true,   -- przypomnienia o wizytach
  consent_marketing_sms   boolean not null default false,
  consent_marketing_email boolean not null default false,
  consent_updated_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists clients_phone_idx on clients (phone);
create index if not exists clients_name_idx  on clients (lower(last_name), lower(first_name));

-- ---------- Wizyty --------------------------------------------------
create table if not exists appointments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete restrict,
  staff_id    uuid not null references staff(id) on delete restrict,
  room_id     uuid references rooms(id) on delete set null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null check (ends_at > starts_at),
  status      appointment_status not null default 'booked',
  price       numeric(10,2),
  source      text not null default 'salon' check (source in ('salon', 'online')),
  client_note text,                     -- uwaga od klientki przy rezerwacji
  staff_note  text,                     -- notatka z zabiegu (produkty, efekty)
  deposit_amount  numeric(10,2),        -- przedpłata
  deposit_method  text check (deposit_method in ('gotowka', 'karta', 'przelew', 'blik', 'online')),
  deposit_paid_at timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- jedna pracownica nie może mieć dwóch wizyt naraz
  constraint no_staff_overlap exclude using gist (
    staff_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('booked', 'confirmed')),
  -- jeden gabinet nie może być zajęty dwa razy naraz
  constraint no_room_overlap exclude using gist (
    room_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (room_id is not null and status in ('booked', 'confirmed'))
);
create index if not exists appointments_time_idx   on appointments (starts_at);
create index if not exists appointments_client_idx on appointments (client_id);

-- ---------- Wiadomości (SMS / e-mail zależne od zabiegu) -----------
-- szablon: dla konkretnego zabiegu albo dla wszystkich (service_id = null)
create table if not exists message_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,           -- np. "Przypomnienie 24h", "Zalecenia po hennie"
  service_id    uuid references services(id) on delete cascade,
  channel       message_channel not null,
  trigger       message_trigger not null,
  offset_hours  int not null default 0,  -- ile godzin przed/po (dla rebook: dni*24)
  subject       text,                    -- tylko e-mail
  body          text not null,           -- z polami: {imie} {zabieg} {data} {godzina} {pracownica} {salon} {link}
  is_marketing  boolean not null default false,  -- wymaga zgody marketingowej
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- kolejka i historia wysłanych wiadomości
create table if not exists message_log (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete set null,
  client_id      uuid references clients(id) on delete set null,
  template_id    uuid references message_templates(id) on delete set null,
  channel        message_channel not null,
  recipient      text not null,
  body           text not null,
  send_at        timestamptz not null,
  sent_at        timestamptz,
  status         text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed', 'skipped')),
  error          text,
  provider_id    text,
  created_at     timestamptz not null default now(),
  unique (appointment_id, template_id)   -- ta sama wiadomość nie pójdzie dwa razy
);
create index if not exists message_log_pending_idx on message_log (send_at) where status = 'pending';

-- =====================================================================
--  Funkcje pomocnicze
-- =====================================================================

-- nowy użytkownik → automatycznie profil klientki
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.phone)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- rola zalogowanej osoby
create or replace function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'client'::user_role)
$$;

create or replace function is_team() returns boolean
language sql stable as $$ select current_role_name() in ('owner', 'staff') $$;

-- automatyczne updated_at
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- nikt poza właścicielką nie zmieni sobie roli
create or replace function protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and current_role_name() <> 'owner' then
    raise exception 'Tylko właścicielka może zmieniać role';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role before update on profiles
  for each row execute function protect_role();

drop trigger if exists appointments_touch on appointments;
create trigger appointments_touch before update on appointments
  for each row execute function touch_updated_at();

-- =====================================================================
--  Bezpieczeństwo (Row Level Security)
--  Zespół widzi wszystko. Klientka widzi tylko swoje dane i wizyty.
--  Oferta (zabiegi, pracownice) jest publiczna – do rezerwacji online.
-- =====================================================================
alter table salon_settings      enable row level security;
alter table profiles            enable row level security;
alter table staff               enable row level security;
alter table rooms               enable row level security;
alter table staff_working_hours enable row level security;
alter table staff_time_off      enable row level security;
alter table service_categories  enable row level security;
alter table services            enable row level security;
alter table staff_services      enable row level security;
alter table service_rooms       enable row level security;
alter table clients             enable row level security;
alter table appointments        enable row level security;
alter table message_templates   enable row level security;
alter table message_log         enable row level security;

-- usuń stare polityki (żeby skrypt dało się uruchomić ponownie)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- publiczny odczyt oferty
create policy "public read" on salon_settings     for select using (true);
create policy "public read" on service_categories for select using (true);
create policy "public read" on services           for select using (active);
create policy "public read" on staff              for select using (active);
create policy "public read" on staff_services     for select using (true);
create policy "public read" on staff_working_hours for select using (true);

-- zespół zarządza wszystkim
create policy "team all" on salon_settings      for all using (is_team()) with check (is_team());
create policy "team all" on staff               for all using (is_team()) with check (is_team());
create policy "team all" on rooms               for all using (is_team()) with check (is_team());
create policy "team all" on staff_working_hours for all using (is_team()) with check (is_team());
create policy "team all" on staff_time_off      for all using (is_team()) with check (is_team());
create policy "team all" on service_categories  for all using (is_team()) with check (is_team());
create policy "team all" on services            for all using (is_team()) with check (is_team());
create policy "team all" on staff_services      for all using (is_team()) with check (is_team());
create policy "team all" on service_rooms       for all using (is_team()) with check (is_team());
create policy "team all" on clients             for all using (is_team()) with check (is_team());
create policy "team all" on appointments        for all using (is_team()) with check (is_team());
create policy "team all" on message_templates   for all using (is_team()) with check (is_team());
create policy "team all" on message_log         for all using (is_team()) with check (is_team());

-- profile: każdy swój, właścicielka wszystkie
create policy "own profile"   on profiles for select using (id = auth.uid() or is_team());
create policy "own update"    on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "owner manages" on profiles for all
  using (current_role_name() = 'owner') with check (current_role_name() = 'owner');

-- klientka: swoja karta (bez notatek salonu – te filtruje aplikacja) i swoje wizyty
create policy "client own card"   on clients for select using (profile_id = auth.uid());
create policy "client own update" on clients for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
create policy "client own appts"  on appointments for select
  using (client_id in (select id from clients where profile_id = auth.uid()));
-- tworzenie i odwoływanie wizyt online pójdzie przez funkcje serwera (dodamy w kolejnym kroku)

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


-- ===== DOŁĄCZONE: 003_panel.sql =====
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

-- ===== DOŁĄCZONE: 005_gabinety.sql =====
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
