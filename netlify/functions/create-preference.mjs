import { MercadoPagoConfig, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';

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

  const cartIds = Array.isArray(payload.cart) ? [...new Set(payload.cart)] : [];
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

  // Buscamos los productos reales en la base — nunca confiamos en precios que mande el navegador.
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, price, status')
    .in('id', cartIds);

  if (productsError) {
    console.error(productsError);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al buscar los productos' }) };
  }
  if (!products || products.length !== cartIds.length) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Algún producto del carrito ya no existe' }) };
  }
  const sold = products.filter(p => p.status === 'vendido');
  if (sold.length > 0) {
    return { statusCode: 409, body: JSON.stringify({ error: `Ya no está disponible: ${sold.map(p => p.name).join(', ')}` }) };
  }

  const total = products.reduce((sum, p) => sum + Number(p.price), 0);

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
        total
      })
      .select()
      .single();
    if (orderError) throw orderError;
    orderId = order.id;

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(products.map(p => ({
        order_id: orderId,
        product_id: p.id,
        product_name: p.name,
        product_price: p.price
      })));
    if (itemsError) throw itemsError;

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: products.map(p => ({
          title: String(p.name).slice(0, 200),
          quantity: 1,
          unit_price: Number(p.price),
          currency_id: 'ARS'
        })),
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
