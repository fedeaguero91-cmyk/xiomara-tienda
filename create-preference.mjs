import { MercadoPagoConfig, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import { quoteCorreoShipping } from './correo-quote.mjs';
import { sendOrderNotification } from './_email.mjs';

// Esta función corre en el servidor de Netlify, nunca en el navegador del comprador.
// El Access Token vive solo acá, como variable de entorno (MP_ACCESS_TOKEN),
// nunca en el HTML ni en el código que ve el público.

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar Supabase o Mercado Pago en Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const cartRaw = Array.isArray(payload.cart) ? payload.cart : [];
  // Aceptamos tanto [{productId, quantity}] como una lista vieja de solo IDs (compatibilidad).
  const cartMap = new Map();
  for (const item of cartRaw) {
    const id = typeof item === 'string' ? item : item.productId;
    const qty = typeof item === 'string' ? 1 : Math.max(1, Math.floor(Number(item.quantity) || 1));
    if (!id) continue;
    cartMap.set(id, (cartMap.get(id) || 0) + qty);
  }
  const cartIds = [...cartMap.keys()];
  const buyer = payload.buyer || {};

  if (cartIds.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'El carrito está vacío' }) };
  }
  if (!buyer.name || !buyer.phone || !buyer.shippingMethod) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos del comprador' }) };
  }
  if (buyer.shippingMethod === 'correo' && (!buyer.address || !buyer.postalCode)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta la dirección o el código postal' }) };
  }
  if (buyer.shippingMethod === 'uber' && !buyer.address) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta la dirección de entrega' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Protección básica contra pedidos repetidos disparados muy rápido (spam/bots).
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_phone', buyer.phone)
    .gte('created_at', twoMinAgo);
  if ((recentCount || 0) >= 3) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Demasiados pedidos seguidos. Esperá un momento y volvé a intentar.' }) };
  }

  // Buscamos los productos reales en la base — nunca confiamos en precios que mande el navegador.
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, price, stock')
    .in('id', cartIds);

  if (productsError) {
    console.error(productsError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al buscar los productos' }) };
  }
  if (!products || products.length !== cartIds.length) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Algún producto del carrito ya no existe' }) };
  }
  const withoutStock = products.filter(p => Number(p.stock) < cartMap.get(p.id));
  if (withoutStock.length > 0) {
    return { statusCode: 409, body: JSON.stringify({ error: `No hay stock suficiente de: ${withoutStock.map(p => p.name).join(', ')}` }) };
  }

  // Si el método es Correo Argentino y tenemos la API configurada, cotizamos de verdad
  // (nunca confiamos en un precio de envío que mande el navegador).
  let shippingCost = 0;
  let shippingLabel = null;
  if (buyer.shippingMethod === 'correo') {
    try {
      const quote = await quoteCorreoShipping({ cart: [...cartMap.entries()].map(([productId, quantity]) => ({ productId, quantity })), postalCode: buyer.postalCode });
      if (quote.available) {
        shippingCost = Number(quote.price);
        shippingLabel = 'Envío - Correo Argentino';
      }
    } catch (err) {
      console.error('No se pudo cotizar el envío, se sigue sin sumarlo:', err);
    }
  }

  const total = products.reduce((sum, p) => sum + Number(p.price) * cartMap.get(p.id), 0) + shippingCost;

  let orderId = null;

  try {
    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        buyer_name: buyer.name,
        buyer_phone: buyer.phone,
        shipping_method: buyer.shippingMethod,
        shipping_address: buyer.shippingMethod !== 'retiro' ? buyer.address : null,
        shipping_postal_code: buyer.shippingMethod === 'correo' ? buyer.postalCode : null,
        payment_method: 'mercadopago',
        total
      })
      .select()
      .single();
    if (orderError) throw orderError;
    orderId = order.id;

    const orderItemsToInsert = products.map(p => ({
      order_id: orderId,
      product_id: p.id,
      product_name: p.name,
      product_price: p.price,
      quantity: cartMap.get(p.id)
    }));
    if (shippingCost > 0) {
      orderItemsToInsert.push({ order_id: orderId, product_id: null, product_name: shippingLabel, product_price: shippingCost, quantity: 1 });
    }
    const { error: itemsError } = await supabase.from('order_items').insert(orderItemsToInsert);
    if (itemsError) throw itemsError;

    sendOrderNotification({ order, items: orderItemsToInsert }).catch(() => {});

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const mpItems = products.map(p => ({
      title: String(p.name).slice(0, 200),
      quantity: cartMap.get(p.id),
      unit_price: Number(p.price),
      currency_id: 'ARS'
    }));
    if (shippingCost > 0) {
      mpItems.push({ title: shippingLabel, quantity: 1, unit_price: shippingCost, currency_id: 'ARS' });
    }

    const result = await preference.create({
      body: {
        items: mpItems,
        back_urls: {
          success: `${siteUrl}/?pago=exito`,
          failure: `${siteUrl}/?pago=fallo`,
          pending: `${siteUrl}/?pago=pendiente`
        },
        auto_return: 'approved',
        statement_descriptor: 'XIOMARA ACCS',
        external_reference: orderId,
        notification_url: `${siteUrl}/.netlify/functions/mp-webhook`
      }
    });

    await supabase.from('orders').update({ mp_preference_id: result.id }).eq('id', orderId);

    const checkoutUrl = result.sandbox_init_point || result.init_point;

    return { statusCode: 200, body: JSON.stringify({ url: checkoutUrl }) };
  } catch (err) {
    console.error('Error creando preferencia de MP:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No se pudo crear el link de pago. Revisá el token en Netlify.' })
    };
  }
}
