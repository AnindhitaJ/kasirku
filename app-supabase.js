/* Lapisan Supabase untuk KasirKu: menimpa fungsi demo agar membaca/menulis ke database. */
const CONFIGURED=!/xxxx|ISI_/.test(window.SUPABASE_URL+window.SUPABASE_ANON_KEY);
const db=CONFIGURED?supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY):null;
const slug=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
const ok=async p=>{const r=await p;if(r.error){toast(r.error.message||'Terjadi kesalahan');throw r.error}return r.data};
const fe=async e=>{try{return await e.context.text()}catch(_){return e.message}};
const MV={in:'Stok masuk',out:'Stok keluar',adjustment:'Adjustment',sale:'Penjualan'},MVR={'Stok masuk':'in','Stok keluar':'out','Adjustment':'adjustment'};
const idMap={};let _n=1;const lid=u=>u?(idMap[u]||(idMap[u]=_n++)):0;  // uuid -> id lokal (dipakai di onclick)
const emp=(b)=>db.functions.invoke('manage-employee',{body:b});
function save(){}

/* ---- Muat data ---- */
async function loadStores(){
 const st=await ok(db.from('kk_stores').select('id,name,owner_id,kk_products(count)').order('created_at'));
 S.stores=st.map(s=>({id:s.id,name:s.name,prods:Array(s.kk_products[0].count).fill(0),cats:[],txs:[],moves:[],week:[]}));return st}
async function pageAll(mk){const out=[];for(let f=0;;f+=1000){const r=await ok(mk().range(f,f+999));out.push(...r);if(r.length<1000)break}return out}
async function loadStore(id,reset){
 syncBack();S.sid=id;if(reset){S.cart=[];S.cat='Semua';S.q='';S.pq=''}
 const [a,b]=rangeISO();
 const [cats,prods,txs,mv,mvr]=await Promise.all([
  ok(db.from('kk_categories').select('id,name').eq('store_id',id).order('name')),
  ok(db.from('kk_products').select('*').eq('store_id',id).order('name')),
  pageAll(()=>db.from('kk_transactions').select('invoice_no,payment_method,total,created_at,kk_transaction_items(product_id,name,price,qty)').eq('store_id',id).gte('created_at',a).lt('created_at',b).order('created_at')),
  ok(db.from('kk_stock_movements').select('type,qty,note,created_at,kk_products(name)').eq('store_id',id).order('created_at',{ascending:false}).limit(50)),
  pageAll(()=>db.from('kk_stock_movements').select('qty,created_at').eq('store_id',id).gte('created_at',a).lt('created_at',b).order('created_at'))]);
 S.catRows=cats;S.cats=cats.map(c=>c.name);S.cats.forEach(c=>hue[c]=hue[c]||'200 55% 88%');
 S.prods=prods.map(p=>({id:lid(p.id),uid:p.id,n:p.name,c:(cats.find(c=>c.id===p.category_id)||{}).name||'-',p:+p.price,m:+p.cost,s:p.stock,min:p.min_stock}));
 S.txs=txs.map(t=>{const dt=new Date(t.created_at);return{no:t.invoice_no,t:dt.toTimeString().slice(0,5),d:ymd(dt),pay:t.payment_method,total:+t.total,items:t.kk_transaction_items.map(i=>({id:lid(i.product_id),n:i.name,p:+i.price,q:i.qty}))}});
 S.mvIn=mvr.filter(m=>m.qty>0).reduce((x,m)=>x+m.qty,0);S.mvOut=mvr.filter(m=>m.qty<0).reduce((x,m)=>x-m.qty,0);
 S.moves=mv.map(m=>({t:new Date(m.created_at).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),n:(m.kk_products||{}).name||'(produk dihapus)',type:MV[m.type],q:m.qty,note:m.note||'-'}));
 syncBack()}
async function loadStaff(){
 if(S.user!=='owner'){S.users=[{id:S.uid,role:'kasir',stores:S.stores.map(s=>s.id)}];return}
 const rows=await ok(db.from('kk_members').select('user_id,name,store_id,kk_member_secrets(password_plain)'));const g={};
 rows.forEach(r=>{const x=r.kk_member_secrets,pw=Array.isArray(x)?(x[0]||{}).password_plain:(x||{}).password_plain;
  const u=g[r.user_id]||(g[r.user_id]={id:r.user_id,name:r.name,role:'kasir',password:pw||'-',stores:[]});u.stores.push(r.store_id)});
 S.users=Object.values(g)}
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


/* ---- Filter tanggal (dipakai Dashboard, Transaksi, Laporan) ---- */
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parseD=v=>{const[y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d)};
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const fmtD=v=>parseD(v).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
const PRESETS=[['today','Hari ini'],['yest','Kemarin'],['7d','7 hari'],['30d','30 hari'],['month','Bulan ini'],['custom','Pilih tanggal']];
S.preset='today';S.from=S.to=ymd(new Date());
function rangeISO(){return[parseD(S.from).toISOString(),addD(parseD(S.to),1).toISOString()]}
function rangeLabel(){if(S.preset==='today')return'hari ini';if(S.preset==='yest')return'kemarin';return S.from===S.to?fmtD(S.from):fmtD(S.from)+' – '+fmtD(S.to)}
function rangeDays(){return Math.round((parseD(S.to)-parseD(S.from))/864e5)+1}
async function setPreset(k){const t=new Date();S.preset=k;
 if(k==='today')S.from=S.to=ymd(t);
 else if(k==='yest')S.from=S.to=ymd(addD(t,-1));
 else if(k==='7d'){S.from=ymd(addD(t,-6));S.to=ymd(t)}
 else if(k==='30d'){S.from=ymd(addD(t,-29));S.to=ymd(t)}
 else if(k==='month'){S.from=ymd(new Date(t.getFullYear(),t.getMonth(),1));S.to=ymd(t)}
 if(k==='custom'){render();return}
 await reloadRange()}
async function setCustom(){const f=gv('df'),t=gv('dt');if(!f||!t){return}
 if(f>t){toast('Tanggal awal harus sebelum tanggal akhir');return}
 if(rangeDaysOf(f,t)>366){toast('Maksimal rentang 1 tahun');return}
 S.preset='custom';S.from=f;S.to=t;await reloadRange()}
const rangeDaysOf=(f,t)=>Math.round((parseD(t)-parseD(f))/864e5)+1;
async function reloadRange(){try{await loadStore(S.sid)}catch(e){return}render()}
function dateBar(){return`<div class="tools" style="margin-bottom:10px;flex-wrap:nowrap"><div class="chips" style="margin:0;flex:1">${PRESETS.map(([k,l])=>`<button class="chip ${S.preset===k?'on':''}" onclick="setPreset('${k}')">${l}</button>`).join('')}</div></div>
 ${S.preset==='custom'?`<div class="tools"><label class="sm" style="display:grid;gap:2px">Dari<input id="df" type="date" value="${S.from}" max="${ymd(new Date())}" onchange="setCustom()"></label>
 <label class="sm" style="display:grid;gap:2px">Sampai<input id="dt" type="date" value="${S.to}" max="${ymd(new Date())}" onchange="setCustom()"></label></div>`:''}`}

/* Dashboard */
dash=function(){
 const rev=S.txs.reduce((s,t)=>s+t.total,0),qty=S.txs.reduce((s,t)=>s+t.items.reduce((a,i)=>a+i.q,0),0),n=rangeDays();
 // bar: per hari (maks 31 hari), selebihnya per bulan
 const by={},keyOf=n>31?(d=>d.slice(0,7)):(d=>d);
 S.txs.forEach(t=>{const k=keyOf(t.d);by[k]=(by[k]||0)+t.total});
 const keys=[];if(n>31){let c=new Date(parseD(S.from).getFullYear(),parseD(S.from).getMonth(),1);const e=parseD(S.to);while(c<=e){keys.push(ymd(c).slice(0,7));c=new Date(c.getFullYear(),c.getMonth()+1,1)}}
 else for(let i=0;i<n;i++)keys.push(ymd(addD(parseD(S.from),i)));
 const vals=keys.map(k=>by[k]||0),max=Math.max(...vals,1);
 const H=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
 const lb=k=>n>31?parseD(k+'-01').toLocaleDateString('id-ID',{month:'short',year:'2-digit'}):n<=7?H[parseD(k).getDay()]:String(parseD(k).getDate());
 const cnt={};S.txs.forEach(t=>t.items.forEach(i=>cnt[i.n]=(cnt[i.n]||0)+i.q));
 const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,5),low=S.prods.filter(p=>p.s<=p.min);
 $(`<h1>Dashboard</h1><p class="sub">Kondisi toko ${rangeLabel()}</p>${dateBar()}
 <div class="card hero"><div><small>Penjualan ${rangeLabel()}</small><div class="big">${rp(rev)}</div></div>
 <div><small>Transaksi</small><b style="font-size:22px">${S.txs.length}</b></div><div><small>Produk terjual</small><b style="font-size:22px">${qty}</b></div></div>
 <div class="grid g2"><div class="card"><h3>Penjualan ${n>31?'per bulan':'per hari'}</h3><div class="bars" style="gap:${n>15?3:10}px;font-size:${n>15?10:12}px">${vals.map((v,i)=>`<div class="${i===vals.length-1?'t':''}" title="${rp(v)}"><i style="height:${v/max*100}%"></i>${n>15&&i%2?'':lb(keys[i])}</div>`).join('')}</div></div>
 <div class="card"><h3>Produk terlaris</h3>${top.map(([n,q])=>`<div class="row"><span>${n}</span><b>${q} terjual</b></div>`).join('')||'<div class="empty">Belum ada penjualan.</div>'}</div></div>
 <div class="card" style="margin-top:14px"><h3>Stok perlu diisi ulang</h3>${low.length?low.map(p=>`<div class="row"><span>${p.n}</span><span class="tag w">${p.s===0?'Habis':'Sisa '+p.s}</span></div>`).join(''):'<div class="empty">Semua stok aman.</div>'}</div>`)};

/* Transaksi */
txView=function(){const multi=S.from!==S.to;
 $(`<h1>Transaksi</h1><p class="sub">${S.txs.length} transaksi ${rangeLabel()}</p>${dateBar()}
 <div class="card scroll"><table><tr><th>Invoice</th><th>${multi?'Tanggal':'Jam'}</th><th>Metode</th><th>Total</th></tr>
 ${[...S.txs].reverse().map(t=>`<tr style="cursor:pointer" onclick="txDetail('${t.no}')"><td><b>${t.no}</b></td><td>${multi?fmtD(t.d)+', '+t.t:t.t}</td><td>${t.pay}</td><td>${rp(t.total)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Tidak ada transaksi pada periode ini.</td></tr>'}</table></div>`)};

/* Laporan */
rep=function(){const rev=S.txs.reduce((s,t)=>s+t.total,0),n=S.txs.length;
 let profit=0;const by={},sold={};S.prods.forEach(p=>sold[p.n]=0);
 S.txs.forEach(t=>{by[t.pay]=(by[t.pay]||0)+t.total;t.items.forEach(i=>{const p=prod(i.id);profit+=(i.p-(p?p.m:0))*i.q;sold[i.n]=(sold[i.n]||0)+i.q})});
 const rank=Object.entries(sold).sort((a,b)=>b[1]-a[1]);
 const R=(a,b)=>`<div class="row"><span>${a}</span><b>${b}</b></div>`;
 $(`<h1>Laporan</h1><p class="sub">Ringkasan ${rangeLabel()}</p>${dateBar()}
 <div class="card hero"><div><small>Estimasi laba</small><div class="big">${rp(profit)}</div></div><div><small>Pendapatan</small><b style="font-size:22px">${rp(rev)}</b></div></div>
 <div class="grid g2"><div class="card"><h3>Laporan penjualan</h3>${R('Pendapatan',rp(rev))}${R('Total transaksi',n)}${R('Rata-rata per transaksi',rp(n?rev/n:0))}</div>
 <div class="card"><h3>Metode pembayaran</h3>${Object.entries(by).map(([k,v])=>R(k,rp(v))).join('')||'<div class="empty">Belum ada data.</div>'}</div>
 <div class="card"><h3>Produk terlaris</h3>${rank.slice(0,5).map(([k,v])=>R(k,v+' terjual')).join('')}</div>
 <div class="card"><h3>Produk kurang laku</h3>${rank.slice(-5).reverse().map(([k,v])=>R(k,v+' terjual')).join('')}</div>
 <div class="card"><h3>Laporan stok</h3>${R('Total stok masuk','+'+(S.mvIn||0))}${R('Total stok keluar','-'+(S.mvOut||0))}${R('Produk menipis atau habis',S.prods.filter(p=>p.s<=p.min).length)}</div></div>`)};

S.user=null;render();boot();
