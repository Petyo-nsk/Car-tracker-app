// Supabase Edge Function: go
// Нашият линк за препращане към партньор. Записва натискането с номер (cid) и препраща клиента
// към сайта на партньора, като добавя номера към адреса му.
//
//   GET /functions/v1/go?p=<кратко име на партньора>&product=<продукт>[&cid=<номер>][&d=<устройство>]
//   продукт: civil | vignette | casco | oil | tires | chain | charger | inspection | glass
//
// Приложението праща свой cid (за да познае после платената полица). Ако линкът е ползван извън
// приложението (имейл, QR), номерът се прави тук. Препраща само към адреси от таблицата partner_links.
// Пуска се с verify_jwt: false — линкът се отваря директно от браузъра.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PRODUCTS = ['civil', 'vignette', 'casco', 'oil', 'tires', 'chain', 'charger', 'inspection', 'glass']

function text(body: string, status: number) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams
  const slug = (q.get('p') || '').toLowerCase()
  const product = q.get('product') || ''
  if (!/^[a-z0-9-]{3,30}$/.test(slug) || !PRODUCTS.includes(product)) {
    return text('Невалиден линк.', 400)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: link } = await supabase
    .from('partner_links').select('url, cid_param')
    .eq('partner', slug).eq('product', product).eq('active', true).maybeSingle()
  if (!link) return text('Този линк вече не е активен.', 404)

  let cid = q.get('cid') || ''
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(cid)) {
    cid = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  const d = q.get('d') || ''
  const device_id = d.length >= 8 && d.length <= 64 ? d : null

  // Едно натискане на cid — повторно отваряне на същия линк не се брои втори път
  await supabase.from('partner_clicks')
    .upsert({ cid, partner: slug, product, device_id }, { onConflict: 'cid', ignoreDuplicates: true })

  let target: URL
  try {
    target = new URL(link.url)
  } catch (_) {
    return text('Линкът на партньора е невалиден.', 500)
  }
  target.searchParams.set(link.cid_param || 'cid', cid)
  return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' } })
})
