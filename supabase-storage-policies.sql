-- Cualquiera puede VER las fotos (necesario para que el catálogo público las muestre)
create policy "Fotos de productos son públicas"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- Cualquiera con el link del catálogo (y el PIN, para llegar al formulario) puede SUBIR fotos nuevas.
-- No se permite borrar ni sobreescribir archivos existentes, solo agregar.
create policy "Se pueden subir fotos nuevas"
  on storage.objects for insert
  with check (bucket_id = 'product-images');
