import { createClient } from '@supabase/supabase-js';

// Esta función es la ÚNICA forma de escribir en la base de datos.
// El navegador nunca toca Supabase directo para escribir — todo pasa
// por acá, donde validamos el PIN y usamos la clave service_role
// (que nunca se expone al público).

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ADMIN_PIN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar Supabase o el PIN en Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const { pin, action, data } = payload;

  if (pin !== process.env.ADMIN_PIN) {
    return { statusCode: 401, body: JSON.stringify({ error: 'PIN incorrecto' }) };
  }

  const supabase = getClient();

  try {
    switch (action) {
      case 'createProduct': {
        const { name, price, category, description, images, video, status } = data;
        if (!name || !price) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Falta nombre o precio' }) };
        }
        const { data: row, error } = await supabase
          .from('products')
          .insert({
            name, price,
            category: category || null,
            description: description || null,
            images: Array.isArray(images) ? images.slice(0, 3) : [],
            video: video || null,
            status: status || 'disponible'
          })
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ product: row }) };
      }

      case 'updateProduct': {
        const { id, name, price, category, description, images, video, status } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const { data: row, error } = await supabase
          .from('products')
          .update({
            name, price,
            category: category || null,
            description: description || null,
            images: Array.isArray(images) ? images.slice(0, 3) : [],
            video: video || null,
            status
          })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ product: row }) };
      }

      case 'deleteProduct': {
        const { id } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'toggleStatus': {
        const { id, status } = data;
        if (!id || !status) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id o status' }) };
        const { data: row, error } = await supabase
          .from('products')
          .update({ status })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ product: row }) };
      }

      case 'updateSettings': {
        const { store_name, tagline, whatsapp } = data;
        const { data: row, error } = await supabase
          .from('store_settings')
          .update({ store_name, tagline, whatsapp })
          .eq('id', 1)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ settings: row }) };
      }

      case 'listOrders': {
        const { data: rows, error } = await supabase
          .from('orders')
          .select('*, order_items(*)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ orders: rows }) };
      }

      case 'updateShippingStatus': {
        const { id, shipping_status } = data;
        if (!id || !shipping_status) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id o shipping_status' }) };
        const { data: row, error } = await supabase
          .from('orders')
          .update({ shipping_status })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ order: row }) };
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Acción desconocida' }) };
    }
  } catch (err) {
    console.error('Error en admin-products:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al guardar en la base de datos' }) };
  }
}
