// Supabase Edge Function: admin-generate-code
// Единствената функция, която МОЖЕ да създава нови промо кодове и да показва статистиката.
// ПИН-ът се проверява тук, на сървъра — не в браузъра — така че никой,
// колкото и да гледа кода на страницата, не може да го заобиколи.
//
// Заявки (POST JSON):
//   { pin, name, months }                              → нов еднократен код
//   { pin, name, months, reusable: true, code? }       → партньорски код (многократен, със статистика)
//   { pin, action: 'stats' }                           → партньорските кодове + брой клиенти

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS — задължително за Edge Functions, иначе браузърът блокира отговора
// когато страницата е на друг домейн от Supabase.
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
    const { pin, name, months, reusable, code: customCode, action } = await req.json()

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
