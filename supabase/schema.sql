-- =====================================================================
--  SALON – schemat bazy danych (Supabase / PostgreSQL)
--  Wklej całość w Supabase → SQL Editor → Run. Można uruchomić ponownie.
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
  name       text not null unique,      -- np. "Twarz", "Rzęsy", "Depilacja"
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
  service_id  uuid not null references services(id) on delete restrict,
  staff_id    uuid not null references staff(id) on delete restrict,
  room_id     uuid references rooms(id) on delete set null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null check (ends_at > starts_at),
  status      appointment_status not null default 'booked',
  price       numeric(10,2),
  source      text not null default 'salon' check (source in ('salon', 'online')),
  client_note text,                     -- uwaga od klientki przy rezerwacji
  staff_note  text,                     -- notatka z zabiegu (produkty, efekty)
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

-- =====================================================================
--  Przykładowe dane – usuń albo zmień na swoje
-- =====================================================================
insert into service_categories (name, sort_order) values
  ('Twarz', 1), ('Rzęsy i brwi', 2), ('Dłonie i stopy', 3)
on conflict do nothing;
