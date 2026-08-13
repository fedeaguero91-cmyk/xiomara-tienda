-- Tabla de productos del catálogo de xiomara.accs
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  category text,
  image text,
  status text not null default 'disponible' check (status in ('disponible', 'vendido')),
  created_at timestamptz not null default now()
);

-- Tabla de ajustes generales de la tienda (nombre, tagline, whatsapp)
create table store_settings (
  id int primary key default 1,
  store_name text not null default 'xiomara.accs',
  tagline text not null default 'Accesorios de importación',
  whatsapp text not null default '',
  constraint single_row check (id = 1)
);

insert into store_settings (id) values (1);

-- Seguridad: cualquiera puede LEER (así funciona el catálogo público),
-- pero nadie puede escribir directo desde el navegador.
-- Las escrituras (agregar/editar/borrar producto) van a pasar siempre
-- por una función de Netlify que valida el PIN antes de tocar la base.
alter table products enable row level security;
alter table store_settings enable row level security;

create policy "Cualquiera puede ver productos"
  on products for select
  using (true);

create policy "Cualquiera puede ver los ajustes"
  on store_settings for select
  using (true);

-- Ojo: no creamos políticas de insert/update/delete a propósito.
-- Eso significa que, por defecto, nadie puede escribir desde el navegador
-- con la clave pública (anon key) — solo nuestra función de servidor,
-- que usa una clave distinta (service_role) que nunca se expone.
