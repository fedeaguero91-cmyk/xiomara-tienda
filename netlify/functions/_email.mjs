// Envía un email de aviso a Xiomara cuando entra un pedido nuevo.
// Necesita RESEND_API_KEY y ADMIN_NOTIFICATION_EMAIL en Netlify.
// Si faltan, no rompe nada: simplemente no manda el aviso.

export async function sendOrderNotification({ order, items }) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_NOTIFICATION_EMAIL) return;

  const itemsHtml = items.map(i =>
    `<li>${i.product_name} ${i.quantity > 1 ? '×' + i.quantity : ''} — $${Number(i.product_price).toLocaleString('es-AR')}</li>`
  ).join('');

  const methodLabel = order.payment_method === 'transferencia' ? 'Transferencia bancaria' : 'Mercado Pago';

  const html = `
    <h2>Nuevo pedido en Xiomisgoodies</h2>
    <p><b>Total:</b> $${Number(order.total).toLocaleString('es-AR')}</p>
    <p><b>Comprador:</b> ${order.buyer_name} · ${order.buyer_phone}</p>
    <p><b>Pago:</b> ${methodLabel}</p>
    <p><b>Envío:</b> ${order.shipping_method}${order.shipping_address ? ' — ' + order.shipping_address : ''}</p>
    <p><b>Productos:</b></p>
    <ul>${itemsHtml}</ul>
    <p>Entrá al panel para ver el detalle completo.</p>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'Xiomisgoodies <onboarding@resend.dev>',
        to: process.env.ADMIN_NOTIFICATION_EMAIL,
        subject: `Nuevo pedido: $${Number(order.total).toLocaleString('es-AR')} (${methodLabel})`,
        html
      })
    });
  } catch (err) {
    console.error('No se pudo mandar el email de aviso:', err);
  }
}
