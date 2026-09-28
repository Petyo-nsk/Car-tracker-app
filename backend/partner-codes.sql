-- Партньорски кодове със статистика (напр. INSURANCEBG за брокер).
-- БЕЗОПАСНО за пускане върху съществуващата база — НЕ трие кодове.
-- Пуска се веднъж в Supabase → SQL Editor. (schema.sql вече съдържа същото за нова база.)

-- Всяко приложено въвеждане на код от едно устройство = един ред.
-- Едно устройство се брои само веднъж за даден код, за да е честна статистиката.
create table if not exists promo_redemptions (
  id bigserial primary key,
  code text not null references promo_codes(code) on delete cascade,
  device_id text not null,
  redeemed_at timestamptz not null default now(),
  unique (code, device_id)
);

-- RLS включен, без публични политики: пише се само през функцията, чете се само от Edge Function.
alter table promo_redemptions enable row level security;

-- Старата функция беше само с един параметър — махаме я, за да няма две версии.
drop function if exists redeem_promo_code(text);

create or replace function redeem_promo_code(p_code text, p_device text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months int;
  v_reusable boolean;
begin
  select months, reusable into v_months, v_reusable
    from promo_codes
    where code = p_code and (used = false or reusable = true);

  if v_months is null then
    return json_build_object('valid', false);
  end if;

  if not v_reusable then
    update promo_codes set used = true, used_at = now() where code = p_code;
  end if;

  -- Статистика: старите версии на приложението не пращат устройство — тогава не броим.
  if p_device is not null and length(p_device) between 8 and 64 then
    insert into promo_redemptions (code, device_id)
      values (p_code, p_device)
      on conflict (code, device_id) do nothing;
  end if;

  return json_build_object('valid', true, 'months', v_months);
end;
$$;

grant execute on function redeem_promo_code(text, text) to anon;
