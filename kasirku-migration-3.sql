-- Migrasi 3: penjualan offline yang aman.
-- Tiap penjualan membawa client_id unik. Kalau dikirim ulang (sinyal putus saat sinkron),
-- server mengembalikan transaksi yang sama, bukan membuat transaksi ganda.
-- p_at = waktu penjualan sebenarnya (saat dicatat offline), tidak boleh di masa depan.

alter table kk_transactions add column if not exists client_id uuid;
create unique index if not exists kk_tx_client_id_uq on kk_transactions (client_id) where client_id is not null;

drop function if exists kk_checkout(uuid, text, jsonb);

create function kk_checkout(p_store uuid, p_method text, p_items jsonb, p_client_id uuid default null, p_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid := gen_random_uuid();
  v_total numeric := 0;
  v_no text;
  v_at timestamptz := least(coalesce(p_at, now()), now());
  it jsonb;
  pr kk_products%rowtype;
begin
  if not kk_can_access(p_store) then raise exception 'Tidak punya akses ke toko ini'; end if;
  if p_client_id is not null then
    select id into v_tx from kk_transactions where client_id = p_client_id and store_id = p_store;
    if found then return v_tx; end if;
    v_tx := gen_random_uuid();
  end if;
  select 'INV-' || lpad((count(*) + 1)::text, 4, '0') into v_no from kk_transactions where store_id = p_store;
  begin
    insert into kk_transactions (id, store_id, invoice_no, cashier_id, payment_method, total, created_at, client_id)
      values (v_tx, p_store, v_no, auth.uid(), p_method, 0, v_at, p_client_id);
  exception when unique_violation then
    select id into v_tx from kk_transactions where client_id = p_client_id and store_id = p_store;
    return v_tx;
  end;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from kk_products where id = (it->>'product_id')::uuid and store_id = p_store for update;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if pr.stock < (it->>'qty')::int then raise exception 'Stok % tidak cukup', pr.name; end if;
    update kk_products set stock = stock - (it->>'qty')::int where id = pr.id;
    insert into kk_transaction_items (transaction_id, store_id, product_id, name, price, cost, qty)
      values (v_tx, p_store, pr.id, pr.name, pr.price, pr.cost, (it->>'qty')::int);
    insert into kk_stock_movements (store_id, product_id, type, qty, note, created_by, created_at)
      values (p_store, pr.id, 'sale', -(it->>'qty')::int, v_no, auth.uid(), v_at);
    v_total := v_total + pr.price * (it->>'qty')::int;
  end loop;
  update kk_transactions set total = v_total where id = v_tx;
  return v_tx;
end $$;
revoke all on function kk_checkout(uuid, text, jsonb, uuid, timestamptz) from public;
grant execute on function kk_checkout(uuid, text, jsonb, uuid, timestamptz) to authenticated;
