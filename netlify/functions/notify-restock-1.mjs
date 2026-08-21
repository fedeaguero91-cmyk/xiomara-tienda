import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar Supabase en Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const productId = payload.productId;
  const phone = String(payload.phone || '').trim();
  if (!productId || !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el producto o el teléfono' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('stock_notifications').insert({ product_id: productId, phone });
    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error guardando aviso de stock:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'No se pudo guardar tu aviso' }) };
  }
}
