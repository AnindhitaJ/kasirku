-- KasirKu POS: Owner -> Toko -> Karyawan
-- Semua objek berawalan kk_ supaya tidak bentrok dengan tabel yang sudah ada.
-- Jalankan di Supabase Dashboard > SQL Editor.

create table kk_stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Karyawan (kasir) <-> toko, many-to-many. Owner tidak perlu masuk tabel ini.
create table kk_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references kk_stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  unique (store_id, user_id)
);

-- OPSIONAL: kata sandi terbaca untuk Owner. Hapus tabel ini jika tidak ingin menyimpannya.
create table kk_member_secrets (
  member_id uuid primary key references kk_members(id) on delete cascade,
  password_plain text not null
);

create table kk_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references kk_stores(id) on delete cascade,
  name text not null
);

create table kk_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references kk_stores(id) on delete cascade,
  category_id uuid references kk_categories(id) on delete set null,
  name text not null,
  cost numeric not null default 0,
  price numeric not null,
  stock int not null default 0,
  min_stock int not null default 10
);

create table kk_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references kk_stores(id) on delete cascade,
  invoice_no text not null,
  cashier_id uuid references auth.users(id),
  payment_method text not null check (payment_method in ('Cash','QRIS','Transfer','Debit')),
  total numeric not null,
  created_at timestamptz not null default now()
);

create table kk_transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references kk_transactions(id) on delete cascade,
  store_id uuid not null references kk_stores(id) on delete cascade,
  product_id uuid references kk_products(id) on delete set null,
  name text not null,
  price numeric not null,
  cost numeric not null default 0,
  qty int not null check (qty > 0)
);

create table kk_stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references kk_stores(id) on delete cascade,
  product_id uuid references kk_products(id) on delete set null,
  type text not null check (type in ('in','out','adjustment','sale')),
  qty int not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index on kk_products (store_id);
create index on kk_transactions (store_id, created_at desc);
create index on kk_stock_movements (store_id, created_at desc);
create unique index kk_members_name_key on kk_members (lower(name));

-- Helper akses
create function kk_is_owner(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kk_stores s where s.id = sid and s.owner_id = auth.uid())
$$;

create function kk_can_access(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select kk_is_owner(sid)
      or exists (select 1 from kk_members m where m.store_id = sid and m.user_id = auth.uid())
$$;

-- RLS
alter table kk_stores enable row level security;
alter table kk_members enable row level security;
alter table kk_member_secrets enable row level security;
alter table kk_categories enable row level security;
alter table kk_products enable row level security;
alter table kk_transactions enable row level security;
alter table kk_transaction_items enable row level security;
alter table kk_stock_movements enable row level security;

create policy stores_owner on kk_stores for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy stores_member_read on kk_stores for select using (kk_can_access(id));

create policy members_owner on kk_members for all using (kk_is_owner(store_id)) with check (kk_is_owner(store_id));
create policy members_self_read on kk_members for select using (user_id = auth.uid());

create policy secrets_owner on kk_member_secrets for all
  using (exists (select 1 from kk_members m where m.id = member_id and kk_is_owner(m.store_id)))
  with check (exists (select 1 from kk_members m where m.id = member_id and kk_is_owner(m.store_id)));

-- Produk dan kategori: semua anggota boleh baca, hanya Owner yang boleh ubah
create policy cat_read on kk_categories for select using (kk_can_access(store_id));
create policy cat_write on kk_categories for all using (kk_is_owner(store_id)) with check (kk_is_owner(store_id));
create policy prod_read on kk_products for select using (kk_can_access(store_id));
create policy prod_write on kk_products for all using (kk_is_owner(store_id)) with check (kk_is_owner(store_id));

-- Transaksi dan stok: baca untuk anggota toko; penulisan lewat kk_checkout / Owner
create policy tx_read on kk_transactions for select using (kk_can_access(store_id));
create policy txi_read on kk_transaction_items for select using (kk_can_access(store_id));
create policy mov_read on kk_stock_movements for select using (kk_can_access(store_id));
create policy mov_owner_write on kk_stock_movements for insert with check (kk_is_owner(store_id));

-- Checkout atomik: simpan transaksi, kurangi stok, catat pergerakan stok
create function kk_checkout(p_store uuid, p_method text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid := gen_random_uuid();
  v_total numeric := 0;
  v_no text;
  it jsonb;
  pr kk_products%rowtype;
begin
  if not kk_can_access(p_store) then raise exception 'Tidak punya akses ke toko ini'; end if;
  select 'INV-' || lpad((count(*) + 1)::text, 4, '0') into v_no from kk_transactions where store_id = p_store;
  insert into kk_transactions (id, store_id, invoice_no, cashier_id, payment_method, total)
    values (v_tx, p_store, v_no, auth.uid(), p_method, 0);
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from kk_products where id = (it->>'product_id')::uuid and store_id = p_store for update;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if pr.stock < (it->>'qty')::int then raise exception 'Stok % tidak cukup', pr.name; end if;
    update kk_products set stock = stock - (it->>'qty')::int where id = pr.id;
    insert into kk_transaction_items (transaction_id, store_id, product_id, name, price, cost, qty)
      values (v_tx, p_store, pr.id, pr.name, pr.price, pr.cost, (it->>'qty')::int);
    insert into kk_stock_movements (store_id, product_id, type, qty, note, created_by)
      values (p_store, pr.id, 'sale', -(it->>'qty')::int, v_no, auth.uid());
    v_total := v_total + pr.price * (it->>'qty')::int;
  end loop;
  update kk_transactions set total = v_total where id = v_tx;
  return v_tx;
end $$;
revoke all on function kk_checkout(uuid, text, jsonb) from public;
grant execute on function kk_checkout(uuid, text, jsonb) to authenticated;
