import { MercadoPagoConfig, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';

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

  let title, priceNumber, quantity;

  if (payload.productId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Camino seguro: buscamos el precio real en la base, no confiamos en lo que manda el navegador.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: product, error } = await supabase
      .from('products')
      .select('name, price, status')
      .eq('id', payload.productId)
      .single();

    if (error || !product) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Producto no encontrado' }) };
    }
    if (product.status === 'vendido') {
      return { statusCode: 409, body: JSON.stringify({ error: 'Este producto ya fue vendido' }) };
    }
    title = product.name;
    priceNumber = Number(product.price);
    quantity = 1;
  } else {
    // Camino de compatibilidad (página de prueba simple sin base de datos).
    title = payload.title;
    priceNumber = Number(payload.price);
    quantity = Number(payload.quantity) > 0 ? Number(payload.quantity) : 1;
  }

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
            quantity,
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
