// Supabase Edge Function: admin-generate-code
// Единствената функция, която МОЖЕ да създава нови промо кодове.
// ПИН-ът се проверява тук, на сървъра — не в браузъра — така че никой,
// колкото и да гледа кода на страницата, не може да го заобиколи.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS — задължително за Edge Functions, иначе браузърът блокира отговора
// когато страницата (Artifact) е на друг домейн от Supabase.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Браузърът праща OPTIONS "preflight" заявка преди истинската — трябва да отговорим ОК на нея.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pin, name, months } = await req.json()

    const ADMIN_PIN = (Deno.env.get('ADMIN_PIN') || '').trim() // задава се като "secret" в Supabase, никога в кода
    const pinTrimmed = (pin || '').toString().trim()

    if (!ADMIN_PIN) {
      // секретът изобщо не е зададен на сървъра — различна грешка, за да се разбере веднага
      return new Response(JSON.stringify({ error: 'server_pin_not_configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    if (!pinTrimmed || pinTrimmed !== ADMIN_PIN) {
      return new Response(JSON.stringify({ error: 'invalid_pin' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const monthsNum = parseInt(months, 10)
    if (!monthsNum || monthsNum < 1 || monthsNum > 24) {
      return new Response(JSON.stringify({ error: 'invalid_months' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // "service role" ключ — само тук, никога в клиентски код
    )

    const base = (name || 'PARTNER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARTNER'
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    const code = `${base}-${rand}`

    const { error } = await supabase.from('promo_codes').insert({
      code,
      months: monthsNum,
      generated_by: name || 'Партньор',
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ code, months: monthsNum }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
