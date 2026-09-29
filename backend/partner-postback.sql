-- Сигнал от партньора за платена полица (postback) → приложението обновява датите само, без въпроси,
-- дори клиентът да не се е върнал в приложението след плащането.
-- БЕЗОПАСНО за пускане върху съществуващата база — НЕ трие нищо. Пуска се веднъж в Supabase → SQL Editor.
--
-- Път на данните:
--   1. Бутонът „Поднови“ праща клиента към партньора със случаен номер cid в линка.
--   2. Партньорът при платена полица вика Edge Function `partner-postback` с cid и датите (и своя ключ).
--   3. Приложението при следващо отваряне пита claim_renew_postback(cid) и записва новата полица.
-- Лични данни няма: cid е случаен и не казва кой е човекът.

-- Партньорите, които могат да пращат сигнал. Пазим само SHA-256 на ключа им, не самия ключ.
-- Нов партньор: insert into postback_partners (partner, key_hash) values ('Insurance.bg', encode(sha256('<ключ>'::bytea), 'hex'));
create table if not exists postback_partners (
  partner text primary key,
  key_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table postback_partners enable row level security;

create table if not exists renew_postbacks (
  cid text primary key check (length(cid) between 12 and 64),
  product text not null check (product in ('civil', 'vignette', 'casco')),
  start_date date not null,
  months int check (months between 1 and 12),                                          -- ГО
  vtype text check (vtype in ('day', 'weekend', 'week', 'month', 'quarter', 'year')),  -- винетка
  expiry date,                                                                          -- каско
  partner text not null,
  received_at timestamptz not null default now(),
  claimed_at timestamptz
);
-- RLS включен, без публични политики: пише само Edge Function-ът, чете се само през функцията отдолу.
alter table renew_postbacks enable row level security;

-- Приложението взима „своята“ полица по cid — само веднъж.
create or replace function claim_renew_postback(p_cid text)
returns table (product text, start_date date, months int, vtype text, expiry date, partner text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cid is null or length(p_cid) not between 12 and 64 then return; end if;
  return query
    update renew_postbacks r set claimed_at = now()
    where r.cid = p_cid and r.claimed_at is null
    returning r.product, r.start_date, r.months, r.vtype, r.expiry, r.partner;
end;
$$;

grant execute on function claim_renew_postback(text) to anon;
