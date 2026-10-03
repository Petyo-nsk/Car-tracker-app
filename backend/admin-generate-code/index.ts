// Supabase Edge Function: admin-generate-code
// Единствената функция, която МОЖЕ да създава нови промо кодове и да показва статистиката.
// ПИН-ът се проверява тук, на сървъра — не в браузъра — така че никой,
// колкото и да гледа кода на страницата, не може да го заобиколи.
//
// Заявки (POST JSON):
//   { pin, name, months }                              → нов еднократен код
//   { pin, name, months, reusable: true, code? }       → партньорски код (многократен, със статистика)
//   { pin, action: 'stats' }                           → партньорските кодове + брой клиенти
//   { pin, action: 'partners' }                        → партньорите, линковете им и отчетът за приходите по месеци
//   { pin, action: 'partner_save', slug, name, product, url, commission_eur, commission_pct, lead_eur, auto_return, cid_param, active }
//   { pin, action: 'partner_key', slug }               → нов ключ за сигнала (показва се само веднъж)
//   { pin, action: 'report_add', slug, product, month: 'ГГГГ-ММ', sales, commission_eur, note }  → месечен отчет от партньора

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS — задължително за Edge Functions, иначе браузърът блокира отговора
// когато страницата е на друг домейн от Supabase.
const PRODUCTS = ['civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass']

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
// Число от формата (приема и запетая), в граници; иначе null
function num(v: unknown, max: number) {
  const n = Number(String(v ?? '').replace(',', '.') || 0)
  return n >= 0 && n <= max ? n : null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // Браузърът праща OPTIONS "preflight" заявка преди истинската — трябва да отговорим ОК на нея.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { pin, name, months, reusable, code: customCode, action } = body

    const ADMIN_PIN = (Deno.env.get('ADMIN_PIN') || '').trim() // задава се като "secret" в Supabase, никога в кода
    const pinTrimmed = (pin || '').toString().trim()

    if (!ADMIN_PIN) {
      // секретът изобщо не е зададен на сървъра — различна грешка, за да се разбере веднага
      return json({ error: 'server_pin_not_configured' }, 500)
    }

    if (!pinTrimmed || pinTrimmed !== ADMIN_PIN) {
      return json({ error: 'invalid_pin' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // "service role" ключ — само тук, никога в клиентски код
    )

    if (action === 'stats') {
      const { data: codes, error: codesErr } = await supabase
        .from('promo_codes')
        .select('code, months, generated_by, created_at')
        .eq('reusable', true)
      if (codesErr) return json({ error: codesErr.message }, 500)

      // Броим поотделно за всеки код (count), за да не ни ограничава лимитът от 1000 реда.
      const stats = await Promise.all((codes || []).map(async (c) => {
        const { count } = await supabase
          .from('promo_redemptions')
          .select('id', { count: 'exact', head: true })
          .eq('code', c.code)
        const { data: lastRow } = await supabase
          .from('promo_redemptions')
          .select('redeemed_at')
          .eq('code', c.code)
          .order('redeemed_at', { ascending: false })
          .limit(1)
        return { ...c, clients: count || 0, last_used: lastRow?.[0]?.redeemed_at || null }
      }))
      stats.sort((a, b) => b.clients - a.clients)

      // Натискания на „Поднови ГО“ / „Купи винетка“ — общо и за последните 30 дни
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const renew = await Promise.all(
        ['civil', 'vignette', 'casco'].flatMap((p) => ['open', 'go', 'paid'].map((ev) => [p, ev])).map(async ([product, event]) => {
          const base = () => supabase.from('renew_clicks').select('id', { count: 'exact', head: true })
            .eq('product', product).eq('event', event)
          const { count: total } = await base()
          const { count: last30 } = await base().gte('clicked_on', since)
          return { product, event, total: total || 0, last30: last30 || 0 }
        })
      )

      return json({ stats, renew })
    }

    // ==== Партньори: линкове, ключове, отчет за приходите ====
    if (action === 'partners') {
      const { data: partners, error: e1 } = await supabase.from('partners').select('slug, name, key_hash, created_at').order('created_at')
      const { data: links, error: e2 } = await supabase.from('partner_links').select('*').order('partner')
      const { data: report, error: e3 } = await supabase.rpc('partner_report')
      const err = e1 || e2 || e3
      if (err) return json({ error: err.message }, 500)
      return json({
        partners: (partners || []).map((p) => ({ slug: p.slug, name: p.name, has_key: !!p.key_hash })),
        links: links || [],
        report: report || [],
      })
    }

    if (action === 'partner_save') {
      const slug = String(body.slug || '').toLowerCase().trim()
      const pname = String(body.name || '').trim().slice(0, 60)
      const product = String(body.product || '')
      const cidParam = String(body.cid_param || 'cid').trim()
      const eur = num(body.commission_eur, 1000), pct = num(body.commission_pct, 100), lead = num(body.lead_eur, 1000)
      if (!/^[a-z0-9-]{3,30}$/.test(slug)) return json({ error: 'invalid_slug' }, 400)
      if (!pname) return json({ error: 'invalid_name' }, 400)
      if (!PRODUCTS.includes(product)) return json({ error: 'invalid_product' }, 400)
      if (!/^[A-Za-z0-9_]{1,20}$/.test(cidParam)) return json({ error: 'invalid_cid_param' }, 400)
      if (eur === null || pct === null || lead === null) return json({ error: 'invalid_commission' }, 400)
      let url: URL
      try { url = new URL(String(body.url || '')) } catch (_) { return json({ error: 'invalid_url' }, 400) }
      if (url.protocol !== 'https:') return json({ error: 'invalid_url' }, 400)

      // Само името — ключът на партньора остава непроменен
      const { error: pErr } = await supabase.from('partners').upsert({ slug, name: pname }, { onConflict: 'slug' })
      if (pErr) return json({ error: pErr.message }, 500)
      const active = body.active !== false
      if (active) {
        // Един активен партньор за продукт — предишният става неактивен (не се трие)
        await supabase.from('partner_links').update({ active: false }).eq('product', product).neq('partner', slug)
      }
      const { error: lErr } = await supabase.from('partner_links').upsert({
        partner: slug, product, url: url.toString(), cid_param: cidParam,
        commission_eur: eur, commission_pct: pct, lead_eur: lead,
        auto_return: !!body.auto_return, active, updated_at: new Date().toISOString(),
      }, { onConflict: 'partner,product' })
      if (lErr) return json({ error: lErr.message }, 500)
      return json({ ok: true })
    }

    if (action === 'partner_key') {
      const slug = String(body.slug || '').toLowerCase().trim()
      const key = 'pk_' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const { data, error } = await supabase.from('partners').update({ key_hash: await sha256Hex(key) }).eq('slug', slug).select('slug')
      if (error) return json({ error: error.message }, 500)
      if (!data?.length) return json({ error: 'unknown_partner' }, 404)
      return json({ key })   // пазим само SHA-256 — ключът не може да се покаже втори път
    }

    if (action === 'report_add') {
      const slug = String(body.slug || '').toLowerCase().trim()
      const product = String(body.product || '')
      const month = String(body.month || '')
      const sales = parseInt(body.sales, 10)
      const total = num(body.commission_eur, 1000000)
      if (!PRODUCTS.includes(product)) return json({ error: 'invalid_product' }, 400)
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: 'invalid_month' }, 400)
      if (!(sales >= 0 && sales < 1000000) || total === null) return json({ error: 'invalid_numbers' }, 400)
      const { error } = await supabase.from('partner_reports').upsert({
        partner: slug, product, month: month + '-01', sales, commission_eur: total,
        note: String(body.note || '').slice(0, 200) || null, updated_at: new Date().toISOString(),
      }, { onConflict: 'partner,product,month' })
      if (error) return json({ error: error.code === '23503' ? 'unknown_partner' : error.message }, 500)
      return json({ ok: true })
    }

    const monthsNum = parseInt(months, 10)
    if (!monthsNum || monthsNum < 1 || monthsNum > 24) {
      return json({ error: 'invalid_months' }, 400)
    }

    const base = (name || 'PARTNER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARTNER'
    let code: string
    if (reusable && customCode) {
      // Партньорът получава лесен за запомняне код, напр. INSURANCEBG
      code = customCode.toString().toUpperCase().replace(/[^A-Z0-9-]/g, '')
      if (code.length < 4 || code.length > 20) return json({ error: 'invalid_code' }, 400)
    } else {
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
      code = `${base}-${rand}`
    }

    const { error } = await supabase.from('promo_codes').insert({
      code,
      months: monthsNum,
      generated_by: name || 'Партньор',
      reusable: !!reusable,
    })

    if (error) {
      // 23505 = такъв код вече съществува
      return json({ error: error.code === '23505' ? 'code_exists' : error.message }, error.code === '23505' ? 409 : 500)
    }

    return json({ code, months: monthsNum, reusable: !!reusable })
  } catch (e) {
    return json({ error: 'bad_request' }, 400)
  }
})
