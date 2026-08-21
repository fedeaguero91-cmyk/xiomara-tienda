import { createClient } from '@supabase/supabase-js';

// Cuando alguien comparte el link de un producto (ej. por WhatsApp), la app que
// arma la vista previa (WhatsApp, Instagram, etc.) visita este link con un
// "User-Agent" reconocible antes de mostrarlo. Le devolvemos una página con
// las etiquetas de vista previa correctas. A las personas reales las mandamos
// directo al catálogo con ese producto abierto.

const SUPABASE_URL = 'https://bulwqquqnrrggkcgpphi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1bHdxcXVxbnJyZ2drY2dwcGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTQzMTQsImV4cCI6MjEwMjIzMDMxNH0.6LW67VrcVX8zQ34qm_1UEArjm8MvLWtIX56LoP98KzM';

const BOT_UA = /(whatsapp|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot|Pinterest)/i;

export async function handler(event) {
  const id = event.queryStringParameters?.id;
  const siteUrl = process.env.URL || `https://${event.headers.host}`;

  if (!id) {
    return { statusCode: 302, headers: { Location: siteUrl }, body: '' };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=name,price,description,images,image&id=eq.${id}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const rows = await res.json();
    const product = rows && rows[0];

    const targetUrl = `${siteUrl}/?p=${id}`;

    if (!product) {
      return { statusCode: 302, headers: { Location: siteUrl }, body: '' };
    }

    const userAgent = event.headers['user-agent'] || '';
    if (!BOT_UA.test(userAgent)) {
      return { statusCode: 302, headers: { Location: targetUrl }, body: '' };
    }

    const image = (product.images && product.images[0]) || product.image || `${siteUrl}/logo-xiomisgoodies.png`;
    const price = Number(product.price || 0).toLocaleString('es-AR');
    const description = (product.description ? product.description.slice(0, 150) + ' — ' : '') + `$${price}`;
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>${esc(product.name)} — Xiomisgoodies</title>
<meta property="og:title" content="${esc(product.name)} — Xiomisgoodies">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(targetUrl)}">
<meta property="og:type" content="product">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(targetUrl)}">
</head><body>Redirigiendo a <a href="${esc(targetUrl)}">${esc(product.name)}</a>...</body></html>`;

    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  } catch (err) {
    console.error('Error armando vista previa:', err);
    return { statusCode: 302, headers: { Location: siteUrl }, body: '' };
  }
}
