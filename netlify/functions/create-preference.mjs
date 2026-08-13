import { MercadoPagoConfig, Preference } from 'mercadopago';

// Esta función corre en el servidor de Netlify, nunca en el navegador del comprador.
// El Access Token vive solo acá, como variable de entorno (MP_ACCESS_TOKEN),
// nunca en el HTML ni en el código que ve el público.

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar MP_ACCESS_TOKEN en Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const { title, price, quantity } = payload;
  const priceNumber = Number(price);

  if (!title || !priceNumber || priceNumber <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta título o el precio no es válido' }) };
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const siteUrl = process.env.URL || `https://${event.headers.host}`;

    const result = await preference.create({
      body: {
        items: [
          {
            title: String(title).slice(0, 200),
            quantity: Number(quantity) > 0 ? Number(quantity) : 1,
            unit_price: priceNumber,
            currency_id: 'ARS'
          }
        ],
        back_urls: {
          success: `${siteUrl}/?pago=exito`,
          failure: `${siteUrl}/?pago=fallo`,
          pending: `${siteUrl}/?pago=pendiente`
        },
        auto_return: 'approved',
        statement_descriptor: 'XIOMARA ACCS'
      }
    });

    // Con credenciales de PRUEBA, Mercado Pago devuelve sandbox_init_point.
    // Con credenciales de PRODUCCIÓN, se usa init_point.
    const checkoutUrl = result.sandbox_init_point || result.init_point;

    return {
      statusCode: 200,
      body: JSON.stringify({ url: checkoutUrl })
    };
  } catch (err) {
    console.error('Error creando preferencia de MP:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No se pudo crear el link de pago. Revisá el token en Netlify.' })
    };
  }
}
