/* Lapisan Supabase untuk KasirKu: menimpa fungsi demo agar membaca/menulis ke database. */
const CONFIGURED=!/xxxx|ISI_/.test(window.SUPABASE_URL+window.SUPABASE_ANON_KEY);
const db=CONFIGURED?supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY):null;
const slug=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
const ok=async p=>{const r=await p;if(r.error){toast(r.error.message||'Terjadi kesalahan');throw r.error}return r.data};
const fe=async e=>{try{return await e.context.text()}catch(_){return e.message}};
const MV={in:'Stok masuk',out:'Stok keluar',adjustment:'Adjustment',sale:'Penjualan'},MVR={'Stok masuk':'in','Stok keluar':'out','Adjustment':'adjustment'};
const idMap={};let _n=1;const lid=u=>u?(idMap[u]||(idMap[u]=_n++)):0;


// ===============================
// EDGE FUNCTION CREATE EMPLOYEE
// ===============================
async function emp(b){

 const {
  data:{
   session
  },
  error:sessionError
 } = await db.auth.getSession();


 if(sessionError){
  throw sessionError;
 }


 if(!session){
  throw new Error(
   'Session login tidak ditemukan. Silakan login ulang.'
  );
 }


 const {
  data,
  error
 } = await db.functions.invoke(
  'create-employee',
  {
   body:b,

   headers:{
    Authorization:
    `Bearer ${session.access_token}`
   }
  }
 );


 if(error){
  console.error(
   'Edge Function Error:',
   error
  );

  throw error;
 }


 return data;

}


function save(){}


/* ---- Muat data ---- */
async function loadStores(){
 const st=await ok(db.from('kk_stores').select('id,name,owner_id,kk_products(count)').order('created_at'));
 S.stores=st.map(s=>({id:s.id,name:s.name,prods:Array(s.kk_products[0].count).fill(0),cats:[],txs:[],moves:[],week:[]}));
 return st
}


async function loadStore(id,reset){
 syncBack();
 S.sid=id;

 if(reset){
  S.cart=[];
  S.cat='Semua';
  S.q='';
  S.pq=''
 }

 const since=new Date(Date.now()-7*864e5).toISOString();

 const [cats,prods,txs,mv]=await Promise.all([
  ok(db.from('kk_categories').select('id,name').eq('store_id',id).order('name')),
  ok(db.from('kk_products').select('*').eq('store_id',id).order('name')),
  ok(db.from('kk_transactions').select('invoice_no,payment_method,total,created_at,kk_transaction_items(product_id,name,price,qty)').eq('store_id',id).gte('created_at',since).order('created_at')),
  ok(db.from('kk_stock_movements').select('type,qty,note,created_at,kk_products(name)').eq('store_id',id).order('created_at',{ascending:false}).limit(50))
 ]);

 S.catRows=cats;
 S.cats=cats.map(c=>c.name);

 S.cats.forEach(c=>{
  hue[c]=hue[c]||'200 55% 88%'
 });


 S.prods=prods.map(p=>({
  id:lid(p.id),
  uid:p.id,
  n:p.name,
  c:(cats.find(c=>c.id===p.category_id)||{}).name||'-',
  p:+p.price,
  m:+p.cost,
  s:p.stock,
  min:p.min_stock
 }));

 const d0=new Date();
 d0.setHours(0,0,0,0);

 S.txs=[];
 S.week=[0,0,0,0,0,0];


 txs.forEach(t=>{

  const dt=new Date(t.created_at);

  if(dt>=d0){

   S.txs.push({
    no:t.invoice_no,
    t:dt.toTimeString().slice(0,5),
    pay:t.payment_method,
    total:+t.total,
    items:t.kk_transaction_items.map(i=>({
     id:lid(i.product_id),
     n:i.name,
     p:+i.price,
     q:i.qty
    }))
   });

  }else{

   const ago=Math.ceil((d0-dt)/864e5);

   if(ago>=1&&ago<=6)
    S.week[6-ago]+=+t.total;

  }

 });


 S.moves=mv.map(m=>({
  t:new Date(m.created_at).toLocaleString('id-ID',{
   day:'numeric',
   month:'short',
   hour:'2-digit',
   minute:'2-digit'
  }),
  n:(m.kk_products||{}).name||'(produk dihapus)',
  type:MV[m.type],
  q:m.q,
  note:m.note||'-'
 }));

 syncBack()

}


async function loadStaff(){

 if(S.user!=='owner'){
  S.users=[
   {
    id:S.uid,
    role:'kasir',
    stores:S.stores.map(s=>s.id)
   }
  ];

  return;
 }


 const rows=await ok(
  db.from('kk_members')
  .select('user_id,name,store_id,kk_member_secrets(password_plain)')
 );


 const g={};


 rows.forEach(r=>{

  const x=r.kk_member_secrets;

  const pw=Array.isArray(x)
   ? (x[0]||{}).password_plain
   : (x||{}).password_plain;


  const u=g[r.user_id] || (
   g[r.user_id]={
    id:r.user_id,
    name:r.name,
    role:'kasir',
    password:pw||'-',
    stores:[]
   }
  );


  u.stores.push(r.store_id);

 });


 S.users=Object.values(g)

}
async function newStore(name,uid){
 const s=await ok(db.from('kk_stores').insert({owner_id:uid,name}).select('id').single());
 await ok(db.from('kk_categories').insert(DEFCATS.map(n=>({store_id:s.id,name:n}))));return s}

/* ---- Auth ---- */
async function boot(){
 if(!CONFIGURED){S.user=null;render();return}
 const {data:{session}}=await db.auth.getSession();
 if(!session){S.user=null;render();return}
 const u=session.user;S.uid=u.id;
 try{let st=await loadStores();
  const sn=u.user_metadata&&u.user_metadata.store_name;
  if(!st.length&&sn){await newStore(sn,u.id);st=await loadStores()}
  if(!st.length){toast('Akun ini belum ditugaskan ke toko');await db.auth.signOut();S.user=null;render();return}
  S.user=st.some(s=>s.owner_id===u.id)?'owner':'kasir';
  await loadStore(S.stores[0].id,true);await loadStaff();
 }catch(e){S.user=null;render();return}
 S.view=ROLES[S.user].v[0];render()}
function login(){document.getElementById('nav').style.display='none';
 $(`<div style="max-width:380px;margin:8vh auto 0"><div class="brand" style="padding:0 0 6px;font-size:30px">Kasir<b>Ku</b></div><p class="sub">Masuk untuk mulai berjualan</p>
 ${CONFIGURED?'':'<div class="card" style="border-color:var(--warn);margin-bottom:12px">Supabase belum disambungkan. Isi <b>config.js</b> dengan URL dan anon key project Anda.</div>'}
 <div class="card f"><label>Nama atau email<input id="ln" autocomplete="username" placeholder="Karyawan: nama. Owner: email"></label>
 <label>Kata sandi<input id="lp" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"></label><button class="btn" onclick="doLogin()">Masuk</button></div>
 <p class="sm" style="margin-top:12px">Owner baru? <a href="#" onclick="regForm();return false" style="color:var(--em-d)">Daftar dan buat toko</a></p></div>`)}
async function doLogin(){if(!CONFIGURED){toast('Isi config.js dulu');return}
 const v=gv('ln').trim();if(!v){toast('Isi nama atau email');return}
 const {error}=await db.auth.signInWithPassword({email:v.includes('@')?v:slug(v)+'@kasirku.app',password:gv('lp')});
 if(error){toast('Nama/email atau kata sandi salah');return}await boot()}
function regForm(){$(`<div style="max-width:380px;margin:8vh auto 0"><div class="brand" style="padding:0 0 6px;font-size:30px">Kasir<b>Ku</b></div><p class="sub">Daftar sebagai Owner</p>
 <div class="card f"><label>Nama toko<input id="rs"></label><label>Email<input id="re" type="email" autocomplete="email"></label><label>Kata sandi (minimal 6 karakter)<input id="rp" type="password" autocomplete="new-password"></label>
 <button class="btn" onclick="doReg()">Daftar</button></div><p class="sm" style="margin-top:12px"><a href="#" onclick="login();return false" style="color:var(--em-d)">Kembali ke halaman masuk</a></p></div>`)}
async function doReg(){if(!CONFIGURED){toast('Isi config.js dulu');return}
 const sn=gv('rs').trim(),email=gv('re').trim(),password=gv('rp');if(!sn||!email||password.length<6){toast('Lengkapi nama toko, email, dan kata sandi (min. 6)');return}
 const {data,error}=await db.auth.signUp({email,password,options:{data:{store_name:sn}}});if(error){toast(error.message);return}
 if(!data.session){toast('Cek email Anda untuk konfirmasi, lalu masuk');login();return}await boot()}
async function logout(){if(db)await db.auth.signOut();S.user=null;S.uid=null;S.cart=[];render()}
async function switchStore(id){await loadStore(id,true);render()}

/* ---- Penjualan ---- */
const _fin2=finish;
finish=async function(){const items=S.cart.map(i=>({product_id:prod(i.id).uid,qty:i.q})),b=document.getElementById('ok');if(b)b.disabled=true;
 try{await ok(db.rpc('kk_checkout',{p_store:S.sid,p_method:S.pay,p_items:items}))}catch(e){if(b)b.disabled=false;return}
 _fin2();loadStore(S.sid)};

/* ---- Produk, kategori, stok ---- */
async function saveP(id){const n=gv('fn').trim();if(!n||!+gv('fp')){toast('Isi nama dan harga jual');return}
 const cat=S.catRows.find(c=>c.name===gv('fc')),d={name:n,category_id:cat?cat.id:null,cost:+gv('fm')||0,price:+gv('fp'),min_stock:+gv('fx')||0};
 try{if(id)await ok(db.from('kk_products').update(d).eq('id',prod(id).uid));
  else{const s=+gv('fs')||0,r=await ok(db.from('kk_products').insert({...d,store_id:S.sid,stock:s}).select('id').single());
   if(s)await ok(db.from('kk_stock_movements').insert({store_id:S.sid,product_id:r.id,type:'in',qty:s,note:'Stok awal',created_by:S.uid}))}}catch(e){return}
 await loadStore(S.sid);closeM();toast('Produk disimpan');prodView()}
function delP(id){confirmM('Hapus '+prod(id).n+'?',async()=>{try{await ok(db.from('kk_products').delete().eq('id',prod(id).uid))}catch(e){return}
 await loadStore(S.sid);toast('Produk dihapus');prodView()})}
async function saveCat(o){const n=gv('cn').trim();if(!n){toast('Isi nama kategori');return}if(S.cats.includes(n)&&n!==o){toast('Kategori sudah ada');return}
 try{if(o)await ok(db.from('kk_categories').update({name:n}).eq('id',S.catRows.find(c=>c.name===o).id));else await ok(db.from('kk_categories').insert({store_id:S.sid,name:n}))}catch(e){return}
 if(S.cat===o)S.cat='Semua';await loadStore(S.sid);closeM();toast('Kategori disimpan');prodView()}
function delCat(c){const k=S.prods.filter(p=>p.c===c).length;if(k){toast(`Masih dipakai ${k} produk`);return}
 confirmM('Hapus kategori '+c+'?',async()=>{try{await ok(db.from('kk_categories').delete().eq('id',S.catRows.find(x=>x.name===c).id))}catch(e){return}await loadStore(S.sid);prodView()})}
async function saveStock(id){const p=prod(id),ty=gv('st'),n=+gv('sq');if(gv('sq')===''||n<0){toast('Isi jumlah');return}
 const d=ty==='Stok masuk'?n:ty==='Stok keluar'?-n:n-p.s;if(p.s+d<0){toast('Stok tidak boleh minus');return}
 if(d){try{await ok(db.rpc('kk_adjust_stock',{p_product:p.uid,p_delta:d,p_type:MVR[ty],p_note:gv('sn').trim()||null}))}catch(e){return}await loadStore(S.sid)}
 closeM();toast('Stok diperbarui');inv()}

/* ---- Toko dan karyawan ---- */
async function saveStore(){const n=gv('sn2').trim();if(!n){toast('Isi nama toko');return}
 try{await newStore(n,S.uid);await loadStores()}catch(e){return}await loadStore(S.sid||S.stores[0].id);closeM();toast('Toko ditambahkan');render()}
function delStore(id){if(S.stores.length<2){toast('Minimal harus ada satu toko');return}
 confirmM('Hapus '+S.stores.find(s=>s.id===id).name+'? Produk dan transaksinya ikut terhapus.',async()=>{
  try{await ok(db.from('kk_stores').delete().eq('id',id));await loadStores()}catch(e){return}
  await loadStore(S.stores.some(s=>s.id===S.sid)?S.sid:S.stores[0].id,true);await loadStaff();render()})}
const _sf=staffForm;staffForm=function(uid){_sf(uid);if(uid)document.getElementById('un').readOnly=true};
async function saveStaff(uid){const name=gv('un').trim(),password=gv('up').trim();
 if(!name){toast('Isi nama karyawan');return}if(password.length<6){toast('Kata sandi minimal 6 karakter');return}
 const st=S.stores.filter(s=>document.getElementById('cb_'+s.id).checked).map(s=>s.id);if(!st.length){toast('Pilih minimal satu toko');return}
 const r=await emp({action:uid?'update':'create',user_id:uid||undefined,name,password,store_ids:st});
 if(r.error){toast(await fe(r.error));return}await loadStaff();closeM();toast('Akun disimpan');team()}
function delStaff(uid){confirmM('Hapus '+S.users.find(x=>x.id===uid).name+'?',async()=>{const r=await emp({action:'delete',user_id:uid});
 if(r.error){toast(await fe(r.error));return}await loadStaff();team()})}

S.user=null;render();boot();
