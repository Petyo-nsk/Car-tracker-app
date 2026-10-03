// Supabase Edge Function: partner-postback
// Партньорът (брокер / застраховател / продавач на винетки) ни съобщава за заявка или платена полица.
// Записваме я с нашия дял към този момент (за отчета за приходите). При платена полица приложението
// после я взима по cid (claim_renew_postback) и обновява датите само, без въпроси.
//
// Заявка — GET с параметри в адреса или POST (JSON или форма), каквото е по-лесно за партньора:
//   key      — ключът на партньора (или в заглавка x-partner-key)
//   cid      — нашият номер от линка към него
//   product  — civil | vignette | casco (застраховки и винетки) | oil | tires | chain | charger | inspection | glass (магазини и услуги)
//   type     — sale (платена полица / поръчка, по подразбиране) | lead (изпратена заявка)
//   amount   — сума в евро: при магазините е нужна (делът ни е процент от нея), при полиците е по избор
//   Само при type=sale на civil / vignette / casco (за да обновим датите в приложението):
//   start    — начало на новата полица, ГГГГ-ММ-ДД
//   months   — за ГО: 1–12
//   vtype    — за винетка: day | weekend | week | month | quarter | year
//   expiry   — за каско: ГГГГ-ММ-ДД
// Пуска се с verify_jwt: false — партньорите нямат наш Supabase вход; проверката е по ключа им (partners.key_hash).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-partner-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))
const VTYPES = ['day', 'weekend', 'week', 'month', 'quarter', 'year']
const PRODUCTS = ['civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass']
const DATED = ['civil', 'vignette', 'casco']   // при тях продажбата носи дати на полицата

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Параметрите могат да са в адреса, в JSON или във форма
  const p: Record<string, string> = Object.fromEntries(new URL(req.url).searchParams)
  if (req.method === 'POST') {
    const type = req.headers.get('content-type') || ''
    try {
      if (type.includes('application/json')) Object.assign(p, await req.json())
      else if (type.includes('form')) Object.assign(p, Object.fromEntries(await req.formData()))
    } catch (_) {
      return json({ ok: false, error: 'bad_body' }, 400)
    }
  }
  const s = (k: string) => (p[k] ?? '').toString().trim()

  const key = req.headers.get('x-partner-key') || s('key')
  if (!key) return json({ ok: false, error: 'no_key' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: partner } = await supabase
    .from('partners').select('slug').eq('key_hash', await sha256Hex(key)).maybeSingle()
  if (!partner) return json({ ok: false, error: 'bad_key' }, 401)

  const cid = s('cid'), product = s('product'), kind = s('type') || 'sale'
  if (cid.length < 12 || cid.length > 64) return json({ ok: false, error: 'bad_cid' }, 400)
  if (!PRODUCTS.includes(product)) return json({ ok: false, error: 'bad_product' }, 400)
  if (!['sale', 'lead'].includes(kind)) return json({ ok: false, error: 'bad_type' }, 400)

  const row: Record<string, unknown> = { cid, product, kind, partner: partner.slug }
  if (s('amount')) {
    const amount = Number(s('amount').replace(',', '.'))
    if (!(amount >= 0 && amount < 100000)) return json({ ok: false, error: 'bad_amount' }, 400)
    row.amount_eur = amount
  }
  if (kind === 'sale' && DATED.includes(product)) {
    if (!isDate(s('start'))) return json({ ok: false, error: 'bad_start' }, 400)
    row.start_date = s('start')
    if (product === 'civil') {
      const m = parseInt(s('months'), 10)
      if (!(m >= 1 && m <= 12)) return json({ ok: false, error: 'bad_months' }, 400)
      row.months = m
    } else if (product === 'vignette') {
      if (!VTYPES.includes(s('vtype'))) return json({ ok: false, error: 'bad_vtype' }, 400)
      row.vtype = s('vtype')
    } else {
      if (!isDate(s('expiry'))) return json({ ok: false, error: 'bad_expiry' }, 400)
      row.expiry = s('expiry')
    }
  }

  // Нашият дял към този момент — ако после договорим друг, старите продажби не се променят
  const { data: link } = await supabase
    .from('partner_links').select('commission_eur, commission_pct, lead_eur').eq('partner', partner.slug).eq('product', product).maybeSingle()
  // Продажба: фиксиран дял в евро + процент от сумата (магазините). Заявка: договореният дял на заявка.
  const pct = (Number(link?.commission_pct) || 0) * (Number(row.amount_eur) || 0) / 100
  row.commission_eur = kind === 'sale'
    ? Math.round(((Number(link?.commission_eur) || 0) + pct) * 100) / 100
    : Number(link?.lead_eur) || 0

  // Един ред на cid. Повторен сигнал не променя нищо — освен когато заявката е станала платена полица.
  const { data: existing } = await supabase.from('renew_postbacks').select('kind').eq('cid', cid).maybeSingle()
  if (existing) {
    if (existing.kind === 'lead' && kind === 'sale') {
      const { error } = await supabase.from('renew_postbacks').update({ ...row, received_at: new Date().toISOString() }).eq('cid', cid)
      if (error) return json({ ok: false, error: 'db' }, 500)
    }
    return json({ ok: true })
  }
  const { error } = await supabase.from('renew_postbacks').upsert(row, { onConflict: 'cid', ignoreDuplicates: true })
  if (error) return json({ ok: false, error: 'db' }, 500)
  return json({ ok: true })
})
