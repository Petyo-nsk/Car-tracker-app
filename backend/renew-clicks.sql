-- Броене на натисканията на „Поднови ГО“ / „Купи винетка“ / „Поднови каско“ — нашето собствено число,
-- което сравняваме с отчета на брокера.
-- БЕЗОПАСНО за пускане върху съществуващата база — НЕ трие нищо. Пуска се веднъж в Supabase → SQL Editor.

-- event: 'open' = отвори прозореца „Поднови“, 'go' = натисна „Продължи към брокера“,
--        'paid' = после потвърди в приложението, че е платил (сам го казва — сравняваме с отчета на брокера).
-- Едно устройство се брои веднъж на ден за едно и също действие, за да не се надува числото.
create table if not exists renew_clicks (
  id bigserial primary key,
  product text not null check (product in ('civil', 'vignette', 'casco')),
  event text not null check (event in ('open', 'go', 'paid')),
  partner text not null default 'none',
  device_id text not null,
  clicked_on date not null default current_date,
  clicked_at timestamptz not null default now(),
  unique (device_id, product, event, partner, clicked_on)
);

-- RLS включен, без публични политики: пише се само през функцията, чете се само от Edge Function.
alter table renew_clicks enable row level security;

create or replace function log_renew_click(p_product text, p_event text, p_partner text, p_device text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product not in ('civil', 'vignette', 'casco') or p_event not in ('open', 'go', 'paid') then return; end if;
  if p_device is null or length(p_device) not between 8 and 64 then return; end if;
  insert into renew_clicks (product, event, partner, device_id)
    values (p_product, p_event, left(coalesce(nullif(p_partner, ''), 'none'), 40), p_device)
    on conflict do nothing;
end;
$$;

grant execute on function log_renew_click(text, text, text, text) to anon;

-- 29.09.2026: добавено каско. За база, в която таблицата вече съществува (create table if not exists не променя check-а):
alter table renew_clicks drop constraint if exists renew_clicks_product_check;
alter table renew_clicks add constraint renew_clicks_product_check check (product in ('civil', 'vignette', 'casco'));

-- 29.09.2026: добавено събитие 'paid' (потвърдено плащане).
alter table renew_clicks drop constraint if exists renew_clicks_event_check;
alter table renew_clicks add constraint renew_clicks_event_check check (event in ('open', 'go', 'paid'));
