import { createClient } from '@supabase/supabase-js';

// Esta función es la ÚNICA forma de escribir en la base de datos.
// El navegador nunca toca Supabase directo para escribir — todo pasa
// por acá, donde validamos que quien llama esté logueada de verdad
// (con Supabase Auth) y usamos la clave service_role (que nunca se
// expone al público) recién después de confirmar eso.

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1bHdxcXVxbnJyZ2drY2dwcGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTQzMTQsImV4cCI6MjEwMjIzMDMxNH0.6LW67VrcVX8zQ34qm_1UEArjm8MvLWtIX56LoP98KzM';

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const res = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar Supabase en Netlify' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const user = await verifyUser(authHeader);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sesión inválida o vencida' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const { action, data } = payload;

  const supabase = getClient();

  try {
    switch (action) {
      case 'createProduct': {
        const { name, price, category, description, images, video, stock } = data;
        if (!name || !price) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Falta nombre o precio' }) };
        }
        const stockNum = Number.isFinite(Number(stock)) ? Math.max(0, Math.floor(Number(stock))) : 1;
        const { data: row, error } = await supabase
          .from('products')
          .insert({
            name, price,
            category: category || null,
            description: description || null,
            images: Array.isArray(images) ? images.slice(0, 3) : [],
            video: video || null,
            stock: stockNum,
            status: stockNum > 0 ? 'disponible' : 'vendido'
          })
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ product: row }) };
      }

      case 'updateProduct': {
        const { id, name, price, category, description, images, video, stock } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const stockNum = Number.isFinite(Number(stock)) ? Math.max(0, Math.floor(Number(stock))) : 0;
        const { data: row, error } = await supabase
          .from('products')
          .update({
            name, price,
            category: category || null,
            description: description || null,
            images: Array.isArray(images) ? images.slice(0, 3) : [],
            video: video || null,
            stock: stockNum,
            status: stockNum > 0 ? 'disponible' : 'vendido'
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

      case 'setStock': {
        const { id, stock } = data;
        if (!id || stock == null) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id o stock' }) };
        const stockNum = Math.max(0, Math.floor(Number(stock)));
        const { data: row, error } = await supabase
          .from('products')
          .update({ stock: stockNum, status: stockNum > 0 ? 'disponible' : 'vendido' })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ product: row }) };
      }

      case 'listCategories': {
        const { data: rows, error } = await supabase.from('categories').select('*').order('name');
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ categories: rows }) };
      }

      case 'createCategory': {
        const { name } = data;
        if (!name || !name.trim()) return { statusCode: 400, body: JSON.stringify({ error: 'Falta el nombre' }) };
        const { data: row, error } = await supabase
          .from('categories')
          .insert({ name: name.trim() })
          .select()
          .single();
        if (error) {
          if (error.code === '23505') return { statusCode: 409, body: JSON.stringify({ error: 'Esa categoría ya existe' }) };
          throw error;
        }
        return { statusCode: 200, body: JSON.stringify({ category: row }) };
      }

      case 'deleteCategory': {
        const { id } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'listPickupPoints': {
        const { data: rows, error } = await supabase.from('pickup_points').select('*').order('created_at');
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ pickupPoints: rows }) };
      }

      case 'createPickupPoint': {
        const { name, address, hours } = data;
        if (!name || !address) return { statusCode: 400, body: JSON.stringify({ error: 'Falta nombre o dirección' }) };
        const { data: row, error } = await supabase
          .from('pickup_points')
          .insert({ name, address, hours: hours || null })
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ pickupPoint: row }) };
      }

      case 'deletePickupPoint': {
        const { id } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const { error } = await supabase.from('pickup_points').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
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

      case 'deleteOrder': {
        const { id } = data;
        if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Falta id' }) };
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: 'Acción desconocida' }) };
    }
  } catch (err) {
    console.error('Error en admin-products:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al guardar en la base de datos' }) };
  }
}
