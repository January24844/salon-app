-- =====================================================================
--  KONTA DO PANELU – uruchom PO założeniu użytkowników w
--  Supabase → Authentication → Users → Add user → Create new user
--  (zaznacz "Auto Confirm User").
--  Zmień e-maile pracownic poniżej na prawdziwe.
-- =====================================================================

-- Konto główne: pełny dostęp + statystyki
update profiles set role = 'owner', full_name = 'Aleksandra Wilkowska'
where id = (select id from auth.users where email = 'a.wilkowska@nylasercenter.pl');

-- Pozostałe konta: kalendarz, klientki, pracownice, zabiegi (bez statystyk)
update profiles set role = 'staff'
where id in (select id from auth.users where email in (
  'pracownica1@nylasercenter.pl',
  'pracownica2@nylasercenter.pl',
  'recepcja@nylasercenter.pl'
));

-- Sprawdzenie: kto ma jaką rolę
select u.email, p.role, p.full_name
from auth.users u join profiles p on p.id = u.id
order by p.role, u.email;
