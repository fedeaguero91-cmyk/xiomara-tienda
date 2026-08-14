-- Reemplaza el esquema anterior de pedidos (de un producto por compra)
-- por uno que soporta carrito: un pedido (orders) con varios ítems (order_items).

drop table if exists orders cascade;

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_name text not null,
  buyer_phone text not null,
  shipping_method text not null check (shipping_method in ('correo', 'uber', 'retiro')),
  shipping_address text,
  shipping_postal_code text,
  total numeric not null default 0,
  payment_status text not null default 'pendiente' check (payment_status in ('pendiente', 'aprobado', 'rechazado')),
  shipping_status text not null default 'pendiente' check (shipping_status in ('pendiente', 'enviado')),
  mp_preference_id text,
  mp_payment_id text,
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_price numeric not null
);

alter table orders enable row level security;
alter table order_items enable row level security;
-- Sin policies a propósito: son datos personales del comprador,
-- solo el servidor (clave service_role) puede leerlos o escribirlos.
