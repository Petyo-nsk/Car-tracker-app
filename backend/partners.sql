-- Партньори: брокери и застрахователи (бутон „Поднови“) и онлайн магазини за части и гуми.
-- За всички е едно и също: техният линк, нашият дял, броене на натисканията и отчет за приходите.
-- Продукти: civil, vignette, casco (застраховки и винетки — дял в евро на полица);
--           oil, tires, chain, charger (магазини — дял в процент от поръчката);
--           inspection, glass (услуги — за бъдещи бутони).
-- БЕЗОПАСНО за пускане върху съществуващата база — НЕ трие нищо. Пуска се веднъж в Supabase → SQL Editor.
-- Пуска се СЛЕД renew-clicks.sql и partner-postback.sql.
--
-- Път на данните:
--   1. Партньорът се добавя от страницата с паролата (admin-generate-code → partner_save): име, продукт, техният линк, нашият дял.
--   2. Приложението пита get_renew_partners() кой е активният партньор за ГО / винетка / каско.
--   3. „Продължи към партньора“ отваря нашия линк (Edge Function `go`) → записва натискането с номер cid → препраща към сайта му.
--   4. Партньорът съобщава за заявка или платена полица (Edge Function `partner-postback`, с неговия ключ) → ред в renew_postbacks
--      с нашия дял към този момент. Ако не може — въвеждаме месечния му отчет ръчно (partner_reports).
--   5. partner_report() дава по месеци: пратени → заявки → продажби → приход.

create table if not exists partners (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,30}$'),   -- кратко име в линковете, напр. insurancebg
  name text not null,                                          -- как се показва в приложението
  key_hash text unique,                                        -- SHA-256 на ключа за сигнала; самия ключ не пазим
  created_at timestamptz not null default now()
);
alter table partners enable row level security;

create table if not exists partner_links (
  partner text not null references partners(slug) on delete cascade,
  product text not null check (product in ('civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass')),
  url text not null check (url ~ '^https://'),                 -- техният адрес (с техния ref код, ако имат)
  cid_param text not null default 'cid' check (cid_param ~ '^[A-Za-z0-9_]{1,20}$'),  -- как се казва параметърът с нашия номер
  commission_eur numeric(8,2) not null default 0 check (commission_eur >= 0),         -- нашият дял на платена полица / поръчка, в евро
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),  -- или процент от сумата (магазини)
  lead_eur numeric(8,2) not null default 0 check (lead_eur >= 0),                     -- нашият дял на заявка (ако е договорен)
  auto_return boolean not null default false,                  -- партньорът ни праща датите → приложението не пита „Купи ли?“
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (partner, product)
);
alter table partner_links enable row level security;
-- Приложението показва един бутон за продукт → само един активен партньор за продукт (ГО, гуми, масло…)
create unique index if not exists partner_links_one_active on partner_links (product) where active;

-- Всяко препращане през нашия линк. cid е случаен номер — без лични данни.
create table if not exists partner_clicks (
  cid text primary key check (length(cid) between 12 and 64),
  partner text not null,
  product text not null,
  device_id text,
  clicked_at timestamptz not null default now()
);
alter table partner_clicks enable row level security;
create index if not exists partner_clicks_by_partner on partner_clicks (partner, product, clicked_at);

-- Заявки и продажби, съобщени от партньора: добавяме вид, сума и нашия дял към момента на продажбата.
alter table renew_postbacks add column if not exists kind text not null default 'sale';
alter table renew_postbacks add column if not exists amount_eur numeric(10,2);
alter table renew_postbacks add column if not exists commission_eur numeric(8,2) not null default 0;
alter table renew_postbacks alter column start_date drop not null;   -- при заявка още няма дата на полица
alter table renew_postbacks drop constraint if exists renew_postbacks_product_check;
alter table renew_postbacks add constraint renew_postbacks_product_check check (product in ('civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass'));
alter table renew_postbacks drop constraint if exists renew_postbacks_kind_check;
alter table renew_postbacks add constraint renew_postbacks_kind_check check (kind in ('lead', 'sale'));

-- Месечен отчет от партньора, въведен ръчно (когато не може да праща сигнал).
create table if not exists partner_reports (
  partner text not null references partners(slug) on delete cascade,
  product text not null check (product in ('civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass')),
  month date not null,                                         -- първият ден на месеца
  sales int not null default 0 check (sales >= 0),
  commission_eur numeric(10,2) not null default 0 check (commission_eur >= 0),
  note text,
  updated_at timestamptz not null default now(),
  primary key (partner, product, month)
);
alter table partner_reports enable row level security;

-- За приложението: кой е активният партньор за всеки продукт (застраховки и магазини). Адресът му не се издава — минава се през нашия линк.
create or replace function get_renew_partners()
returns table (product text, slug text, name text, auto_return boolean)
language sql
security definer
set search_path = public
stable
as $$
  select l.product, p.slug, p.name, l.auto_return
  from partner_links l join partners p on p.slug = l.partner
  where l.active;
$$;
grant execute on function get_renew_partners() to anon;

-- Приложението взима „своята“ полица по cid — само продажби с дата, само веднъж.
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
    where r.cid = p_cid and r.claimed_at is null and r.kind = 'sale' and r.start_date is not null
    returning r.product, r.start_date, r.months, r.vtype, r.expiry, r.partner;
end;
$$;
grant execute on function claim_renew_postback(text) to anon;

-- Отчет по партньор, продукт и месец. Само за страницата с паролата (през Edge Function със service role).
create or replace function partner_report()
returns table (partner text, name text, product text, month text, clicks bigint, leads bigint, sales bigint,
               revenue numeric, reported_sales bigint, reported_revenue numeric)
language sql
security definer
set search_path = public
stable
as $$
  with c as (
    select pc.partner, pc.product, to_char(pc.clicked_at, 'YYYY-MM') as m, count(*) as n
    from partner_clicks pc group by 1, 2, 3
  ), s as (
    select rp.partner, rp.product, to_char(rp.received_at, 'YYYY-MM') as m,
           count(*) filter (where rp.kind = 'lead') as leads,
           count(*) filter (where rp.kind = 'sale') as sales,
           coalesce(sum(rp.commission_eur), 0) as rev
    from renew_postbacks rp group by 1, 2, 3
  ), r as (
    select pr.partner, pr.product, to_char(pr.month, 'YYYY-MM') as m,
           sum(pr.sales)::bigint as rs, sum(pr.commission_eur) as rr
    from partner_reports pr group by 1, 2, 3
  ), k as (
    select c.partner, c.product, c.m from c
    union select s.partner, s.product, s.m from s
    union select r.partner, r.product, r.m from r
  )
  select k.partner, coalesce(p.name, k.partner), k.product, k.m,
         coalesce(c.n, 0), coalesce(s.leads, 0), coalesce(s.sales, 0), coalesce(s.rev, 0),
         coalesce(r.rs, 0), coalesce(r.rr, 0)
  from k
  left join c on c.partner = k.partner and c.product = k.product and c.m = k.m
  left join s on s.partner = k.partner and s.product = k.product and s.m = k.m
  left join r on r.partner = k.partner and r.product = k.product and r.m = k.m
  left join partners p on p.slug = k.partner
  order by k.m desc, k.partner, k.product;
$$;
revoke all on function partner_report() from public, anon, authenticated;
grant execute on function partner_report() to service_role;

-- Бележка: postback_partners (от partner-postback.sql) вече не се ползва — ключовете са в partners.key_hash.
