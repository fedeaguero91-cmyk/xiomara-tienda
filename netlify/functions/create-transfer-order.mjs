import { createClient } from '@supabase/supabase-js';
import { sendOrderNotification } from './_email.mjs';

// A diferencia de Mercado Pago, acá no hay confirmación automática de pago:
// el pedido queda "pendiente" hasta que Xiomara confirma a mano en el panel
// que recibió la transferencia (ahí recién se descuenta el stock).

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

  const cartRaw = Array.isArray(payload.cart) ? payload.cart : [];
  const cartMap = new Map();
  for (const item of cartRaw) {
    const id = typeof item === 'string' ? item : item.productId;
    const qty = typeof item === 'string' ? 1 : Math.max(1, Math.floor(Number(item.quantity) || 1));
    if (!id) continue;
    cartMap.set(id, (cartMap.get(id) || 0) + qty);
  }
  const cartIds = [...cartMap.keys()];
  const buyer = payload.buyer || {};

  if (cartIds.length === 0) return { statusCode: 400, body: JSON.stringify({ error: 'El carrito está vacío' }) };
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

  const { data: products, error: productsError } = await supabase
    .from('products').select('id, name, price, stock').in('id', cartIds);
  if (productsError) return { statusCode: 500, body: JSON.stringify({ error: 'Error al buscar los productos' }) };
  if (!products || products.length !== cartIds.length) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Algún producto del carrito ya no existe' }) };
  }
  const withoutStock = products.filter(p => Number(p.stock) < cartMap.get(p.id));
  if (withoutStock.length > 0) {
    return { statusCode: 409, body: JSON.stringify({ error: `No hay stock suficiente de: ${withoutStock.map(p => p.name).join(', ')}` }) };
  }

  const { data: settingsRows } = await supabase.from('store_settings').select('*').eq('id', 1);
  const settings = (settingsRows || [])[0] || {};
  const discountPercent = Number(settings.transfer_discount_percent) || 10;

  const subtotal = products.reduce((sum, p) => sum + Number(p.price) * cartMap.get(p.id), 0);
  const total = Math.round(subtotal * (1 - discountPercent / 100));

  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        buyer_name: buyer.name,
        buyer_phone: buyer.phone,
        shipping_method: buyer.shippingMethod,
        shipping_address: buyer.shippingMethod !== 'retiro' ? buyer.address : null,
        shipping_postal_code: buyer.shippingMethod === 'correo' ? buyer.postalCode : null,
        payment_method: 'transferencia',
        total
      })
      .select()
      .single();
    if (orderError) throw orderError;

    const orderItems = products.map(p => ({
      order_id: order.id,
      product_id: p.id,
      product_name: p.name,
      product_price: p.price,
      quantity: cartMap.get(p.id)
    }));
    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
    if (itemsError) throw itemsError;

    sendOrderNotification({ order, items: orderItems }).catch(() => {});

    return {
      statusCode: 200,
      body: JSON.stringify({
        orderId: order.id,
        total,
        discountPercent,
        bank: {
          cbu: settings.transfer_cbu || '',
          alias: settings.transfer_alias || '',
          holder: settings.transfer_holder || ''
        }
      })
    };
  } catch (err) {
    console.error('Error creando pedido por transferencia:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'No se pudo registrar el pedido' }) };
  }
}
