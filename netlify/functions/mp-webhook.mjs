import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';

// Mercado Pago llama a esta función solita (nunca el navegador del comprador)
// cada vez que un pago cambia de estado. La usamos para:
//  1. Confirmar el pago consultando directo a la API de MP (nunca confiamos
//     ciegamente en lo que llega en el aviso, por seguridad).
//  2. Marcar el pedido como aprobado/rechazado.
//  3. Si se aprobó, marcar el producto como "vendido" automáticamente.

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'ok' }; // Mercado Pago a veces prueba con GET, respondemos 200 igual.
  }

  if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno para el webhook');
    return { statusCode: 200, body: 'ok' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, body: 'ok' };
  }

  const paymentId = payload?.data?.id;
  const topic = payload?.type || payload?.topic;

  if (topic !== 'payment' || !paymentId) {
    // Puede ser otro tipo de notificación (merchant_order, etc.) — la ignoramos.
    return { statusCode: 200, body: 'ok' };
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const paymentApi = new Payment(client);
    const payment = await paymentApi.get({ id: paymentId });

    const orderId = payment.external_reference;
    if (!orderId) return { statusCode: 200, body: 'ok' };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    let paymentStatus = 'pendiente';
    if (payment.status === 'approved') paymentStatus = 'aprobado';
    else if (payment.status === 'rejected' || payment.status === 'cancelled') paymentStatus = 'rechazado';

    const { data: order, error } = await supabase
      .from('orders')
      .update({ payment_status: paymentStatus, mp_payment_id: String(paymentId) })
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    // Si el pago se aprobó, marcamos TODOS los productos del pedido como vendidos.
    if (paymentStatus === 'aprobado') {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id')
        .eq('order_id', orderId);
      const productIds = (items || []).map(i => i.product_id).filter(Boolean);
      if (productIds.length > 0) {
        await supabase.from('products').update({ status: 'vendido' }).in('id', productIds);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Error procesando webhook de MP:', err);
    // Igual respondemos 200 para que Mercado Pago no reintente en loop.
    return { statusCode: 200, body: 'ok' };
  }
}
