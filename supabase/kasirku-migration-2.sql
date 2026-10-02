-- Jalankan SETELAH kasirku-schema.sql (aman dijalankan ulang).

-- 1) Perbaikan: karyawan yang bertugas di dua toko punya dua baris di kk_members dengan nama sama,
--    jadi indeks unik nama tidak boleh ada. Keunikan nama dijaga oleh email login (nama@kasirku.app).
drop index if exists kk_members_name_key;

-- 2) Ubah stok atomik (stok masuk, keluar, adjustment). Hanya Owner toko.
create or replace function kk_adjust_stock(p_product uuid, p_delta int, p_type text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare pr kk_products%rowtype;
begin
  if p_type not in ('in','out','adjustment') then raise exception 'Jenis tidak valid'; end if;
  select * into pr from kk_products where id = p_product for update;
  if not found or not kk_is_owner(pr.store_id) then raise exception 'Tidak punya akses'; end if;
  if pr.stock + p_delta < 0 then raise exception 'Stok tidak boleh minus'; end if;
  update kk_products set stock = stock + p_delta where id = pr.id;
  insert into kk_stock_movements (store_id, product_id, type, qty, note, created_by)
    values (pr.store_id, pr.id, p_type, p_delta, p_note, auth.uid());
end $$;
revoke all on function kk_adjust_stock(uuid, int, text, text) from public;
grant execute on function kk_adjust_stock(uuid, int, text, text) to authenticated;
