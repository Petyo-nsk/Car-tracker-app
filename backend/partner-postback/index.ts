// Supabase Edge Function: partner-postback
// Партньорът (брокер / застраховател / продавач на винетки) ни праща сигнал за всяка платена полица.
// Приложението после я взима по cid (claim_renew_postback) и обновява датите само, без въпроси.
//
// Заявка — GET с параметри в адреса или POST (JSON или форма), каквото е по-лесно за партньора:
//   key      — ключът на партньора (или в заглавка x-partner-key)
//   cid      — нашият номер от линка „Поднови“
//   product  — civil | vignette | casco
//   start    — начало на новата полица, ГГГГ-ММ-ДД
//   months   — за ГО: 1–12
//   vtype    — за винетка: day | weekend | week | month | quarter | year
//   expiry   — за каско: ГГГГ-ММ-ДД
// Пуска се с verify_jwt: false — партньорите нямат наш Supabase вход; проверката е по ключа им.

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
    .from('postback_partners').select('partner').eq('key_hash', await sha256Hex(key)).eq('active', true).maybeSingle()
  if (!partner) return json({ ok: false, error: 'bad_key' }, 401)

  const cid = s('cid'), product = s('product'), start = s('start')
  if (cid.length < 12 || cid.length > 64) return json({ ok: false, error: 'bad_cid' }, 400)
  if (!['civil', 'vignette', 'casco'].includes(product)) return json({ ok: false, error: 'bad_product' }, 400)
  if (!isDate(start)) return json({ ok: false, error: 'bad_start' }, 400)

  const row: Record<string, unknown> = { cid, product, start_date: start, partner: partner.partner }
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

  // Един сигнал на cid — повторен сигнал (партньорът опитва пак) не променя нищо
  const { error } = await supabase.from('renew_postbacks').upsert(row, { onConflict: 'cid', ignoreDuplicates: true })
  if (error) return json({ ok: false, error: 'db' }, 500)
  return json({ ok: true })
})
