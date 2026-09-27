-- Схема на базата данни (Supabase / Postgres) за промо кодовете.
-- ВНИМАНИЕ: пускането изтрива таблицата и всички генерирани кодове, после я създава наново.
-- След като я пуснеш, пусни и backend/private/owner-code.sql (личният код — не е в GitHub).

drop table if exists promo_codes cascade;

create table promo_codes (
  code text primary key,
  months int not null,
  generated_by text,
  reusable boolean not null default false, -- true само за личния код на собственика — никога не се маркира като използван
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS включен, без публични политики: достъпът е само през функцията по-долу
-- (за приложението) и през Edge Function admin-generate-code (за генератора).
alter table promo_codes enable row level security;

create or replace function redeem_promo_code(p_code text)
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

  return json_build_object('valid', true, 'months', v_months);
end;
$$;

grant execute on function redeem_promo_code(text) to anon;
