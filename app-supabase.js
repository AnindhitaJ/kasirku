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
/* ---- Auth ---- */

async function login(){

 const v=gv('le').trim();
 const p=gv('lp');


 if(!v||!p){
  toast('Email/nama dan password wajib diisi');
  return;
 }


 const email =
 v.includes('@')
 ? v
 : slug(v)+'@kasirku.app';


 const {
  data,
  error
 } =
 await db.auth.signInWithPassword({
  email,
  password:p
 });


 if(error){
  toast(error.message);
  return;
 }


 S.uid=data.user.id;


 const {data:profile}=await db
 .from('kk_profiles')
 .select('*')
 .eq('id',S.uid)
 .maybeSingle();


 S.user =
 profile?.role ||
 'owner';


 await loadStores();


 if(!S.stores.length){

  await db
  .from('kk_stores')
  .insert({
   owner_id:S.uid,
   name:'Toko Saya'
  });

  await loadStores();

 }


 await loadStore(
  S.stores[0].id,
  true
 );


 await loadStaff();


 render();


 toast('Login berhasil');

}



async function logout(){

 await db.auth.signOut();

 S.uid=null;
 S.user=null;

 location.reload();

}





/* ---- Owner create employee ---- */

async function saveStaff(){

 const name =
 gv('staff-name');


 const password =
 gv('staff-password');


 const store_ids =
 S.stores
 .filter(
  s=>s.checked
 )
 .map(
  s=>s.id
 );


 if(!name||!password){

  toast(
   'Nama dan password wajib diisi'
  );

  return;

 }


 try{


  const result =
  await emp({

   action:'create',

   name,

   password,

   store_ids

  });


  console.log(
   'CREATE EMPLOYEE RESULT:',
   result
  );


  toast(
   'Akun karyawan berhasil dibuat'
  );


  await loadStaff();

  render();


 }
 catch(e){

  console.error(
   e
  );

  toast(
   e.message ||
   'Gagal membuat akun'
  );

 }

}





/* ---- Update employee ---- */

async function updateStaff(id){

 const u =
 S.users.find(
  x=>x.id===id
 );


 if(!u)
 return;


 try{


  await emp({

   action:'update',

   user_id:id,

   name:u.name,

   password:u.password,

   store_ids:u.stores

  });


  toast(
   'Data karyawan diperbarui'
  );


  await loadStaff();

  render();


 }
 catch(e){

  toast(
   e.message
  );

 }


}





/* ---- Delete employee ---- */

async function deleteStaff(id){

 if(!confirm(
  'Hapus akun karyawan?'
 ))
 return;


 try{


  await emp({

   action:'delete',

   user_id:id

  });


  toast(
   'Karyawan dihapus'
  );


  await loadStaff();

  render();


 }
 catch(e){

  toast(
   e.message
  );

 }

}




/* ---- Register Owner ---- */

async function registerOwner(){

 const name =
 gv('register-name');


 const email =
 gv('register-email');


 const password =
 gv('register-password');


 const {
  data,
  error
 } =
 await db.auth.signUp({

  email,

  password

 });


 if(error){

  toast(
   error.message
  );

  return;

 }


 await db
 .from('kk_profiles')
 .insert({

  id:data.user.id,

  name,

  role:'owner'

 });


 await db
 .from('kk_stores')
 .insert({

  owner_id:data.user.id,

  name:name+' Store'

 });


 toast(
  'Registrasi berhasil'
 );


 location.reload();

}




/* ---- Init ---- */

async function init(){

 if(!CONFIGURED){

  toast(
   'Supabase belum dikonfigurasi'
  );

  return;

 }


 const {
  data:{
   session
  }
 } =
 await db.auth.getSession();


 if(session){

  S.uid=session.user.id;


  await loadStores();


  if(S.stores.length){

   await loadStore(
    S.stores[0].id,
    true
   );

  }


  await loadStaff();

 }


 render();

}


init();
