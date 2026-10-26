# Instrukcja uruchomienia aplikacji salonu

## 1. Programy na komputerze
- Node.js w wersji LTS: https://nodejs.org
- Visual Studio Code: https://code.visualstudio.com
- Git: https://git-scm.com

## 2. Supabase (baza danych)
1. Załóż konto na https://supabase.com, logując się przez GitHub, i kliknij **New project**.
2. Region: **Frankfurt (Central EU)**. Hasło do bazy zapisz w bezpiecznym miejscu.
3. Wejdź w **SQL Editor → New query**, wklej zawartość pliku `supabase/baza_od_zera.sql` i kliknij **Run**.
   (Jeśli baza była już założona wcześniej – uruchom tylko `supabase/003_panel.sql`).
4. W **Project Settings → API** skopiuj `Project URL` oraz klucze `anon` i `service_role`.

## 3. Uruchomienie na komputerze
```
npm install
```
Skopiuj plik `.env.example` jako `.env.local` i wklej do niego dane z Supabase. Potem uruchom:
```
npm run dev
```
Otwórz w przeglądarce http://localhost:3000. Strona pokaże listę kontrolną z tym, co już działa.

## 3a. Konta do panelu
1. Supabase → **Authentication → Users → Add user → Create new user**: e-mail + hasło, zaznacz **Auto Confirm User**. Powtórz dla każdej osoby.
2. Otwórz `supabase/004_konta.sql`, wpisz prawdziwe e-maile pracownic, wklej w **SQL Editor** i kliknij **Run**.
3. Konto `a.wilkowska@nylasercenter.pl` = właścicielka (statystyki, cofanie finalizacji, cennik). Pozostałe = pracownice.

## 4. Vercel (aplikacja w internecie)
1. Wrzuć projekt na GitHub jako repozytorium **prywatne**.
2. Na https://vercel.com wybierz **Add New → Project**, wskaż to repozytorium, wpisz w **Environment Variables** te same wartości co w `.env.local` i kliknij **Deploy**.

## 5. Podpięcie istniejącej domeny salonu
Obecnej strony salonu nie ruszamy. Aplikacja dostanie **subdomenę**, np. `rezerwacje.twojsalon.pl`.
1. W Vercelu: **Settings → Domains → Add** i wpisz `rezerwacje.twojsalon.pl`.
2. Vercel poda rekord typu **CNAME**. Dodaj go w panelu DNS domeny, tam, gdzie domena jest zarządzana (hosting strony albo rejestrator).
3. Nie zmieniaj innych rekordów, a zwłaszcza **MX**, czyli poczty salonu, ani **A** głównej strony.
4. Na stronie salonu dodaj przycisk „Umów wizytę” prowadzący pod nowy adres.

## 6. Maile (Resend)
1. Na https://resend.com wybierz **Domains → Add domain** i wpisz tę samą domenę.
2. Dodaj w DNS rekordy, które poda Resend (zwykle TXT/MX na subdomenie `send.` oraz DKIM). Nie kolidują one z obecną pocztą.
3. Wygeneruj klucz w **API Keys** i wklej go jako `RESEND_API_KEY` do `.env.local` i do Vercela.
4. Nadawca może wyglądać np. tak: `Salon <wizyty@twojsalon.pl>`.

## 7. SMS (SMSAPI) – opcjonalnie
Załóż konto na smsapi.pl, zgłoś nazwę nadawcy (maksymalnie 11 znaków) i wklej token jako `SMSAPI_TOKEN`.

## Bezpieczeństwo
- Plik `.env.local` nigdy nie trafia na GitHub.
- Klucz `service_role` traktuj jak hasło do banku.
