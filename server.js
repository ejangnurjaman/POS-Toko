const express=require('express'),cors=require('cors'),os=require('os'),crypto=require('crypto'),path=require('path');
const Database=require('better-sqlite3');
const db=new Database(process.env.DB_PATH||'pos.db');db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,username TEXT UNIQUE,password TEXT,role TEXT CHECK(role IN('admin','karyawan')));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,barcode TEXT UNIQUE,name TEXT NOT NULL,category TEXT,cost_price INTEGER DEFAULT 0,selling_price INTEGER DEFAULT 0,stock INTEGER DEFAULT 0,min_stock INTEGER DEFAULT 0,created_at TEXT DEFAULT(datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS stock_logs(id INTEGER PRIMARY KEY,product_id INTEGER,type TEXT CHECK(type IN('in','out')),qty INTEGER,note TEXT,created_at TEXT DEFAULT(datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,invoice_number TEXT UNIQUE,total_amount INTEGER,total_cost INTEGER,total_profit INTEGER,discount INTEGER DEFAULT 0,payment_method TEXT,cash_received INTEGER,change_amount INTEGER,user_id INTEGER,created_at TEXT DEFAULT(datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS transaction_details(id INTEGER PRIMARY KEY,transaction_id INTEGER,product_id INTEGER,product_name TEXT,cost_price INTEGER,selling_price INTEGER,qty INTEGER,subtotal INTEGER,profit INTEGER);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(created_at);`);
db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)`);
try{db.exec('ALTER TABLE transactions ADD COLUMN client_ref TEXT')}catch{}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_ref ON transactions(client_ref) WHERE client_ref IS NOT NULL');
const hash=p=>crypto.createHash('sha256').update('pos-salt:'+p).digest('hex');
if(!db.prepare('SELECT 1 FROM users').get()){
 const i=db.prepare('INSERT INTO users(name,username,password,role) VALUES(?,?,?,?)');
 i.run('Owner','admin',hash('admin123'),'admin');i.run('Kasir 1','kasir',hash('kasir123'),'karyawan');}
const sessions=new Map();
const app=express();app.use(cors());app.use(express.json({limit:'25mb'}));const fs=require('fs');
// Cari file di public/js, public, js, atau folder yang sama dengan server.js (jaga-jaga jika struktur folder berbeda)
const find=n=>[['public','js',n],['public',n],['js',n],[n]].map(p=>path.join(__dirname,...p)).find(fs.existsSync);
app.get('/js/:n',(q,r)=>{const n=q.params.n,f=['printer.js','export.js','offlineQueue.js'].includes(n)&&find(n);
 f?r.sendFile(f):r.status(404).type('text').send('File '+n+' tidak ditemukan. Taruh di pos-app/public/js/');});
app.get('/',(q,r)=>{const f=find('index.html');f?r.sendFile(f):r.status(404).send('index.html tidak ditemukan. Taruh di pos-app/public/');});
app.use(express.static(path.join(__dirname,'public')));
for(const n of ['index.html','printer.js','export.js','offlineQueue.js'])if(!find(n))console.warn('PERINGATAN: '+n+' tidak ditemukan');
else if(!find(n).includes(path.join(__dirname,'public')))console.warn('INFO: '+n+' ada di '+find(n)+' (sebaiknya pindah ke public/'+(n==='index.html'?'':'js/')+')');
const auth=(role)=>(req,res,next)=>{const s=sessions.get((req.headers.authorization||'').replace('Bearer ',''));
 if(!s)return res.status(401).json({error:'Belum login'});
 if(role&&s.role!==role)return res.status(403).json({error:'Khusus admin'});req.user=s;next();};
const ok=Number.isFinite;

app.get('/api/server-info',(q,r)=>{const ips=[];for(const l of Object.values(os.networkInterfaces()))for(const a of l)if(a.family==='IPv4'&&!a.internal)ips.push(a.address);
 r.json({ips,port:PORT,urls:ips.map(i=>`http://${i}:${PORT}`)});});
app.post('/api/auth/login',(q,r)=>{const{username,password}=q.body;
 const u=db.prepare('SELECT * FROM users WHERE username=? AND password=?').get(username,hash(password||''));
 if(!u)return r.status(401).json({error:'Username/password salah'});
 const token=crypto.randomBytes(24).toString('hex');sessions.set(token,{id:u.id,name:u.name,role:u.role});
 r.json({token,user:{id:u.id,name:u.name,role:u.role}});});

app.get('/api/products',auth(),(q,r)=>{
 const cols=q.user.role==='admin'?'*':'id,barcode,name,category,selling_price,stock';
 r.json(db.prepare(`SELECT ${cols} FROM products ORDER BY name`).all());});
const pv=b=>({barcode:b.barcode||null,name:b.name,category:b.category||'',cost_price:+b.cost_price||0,selling_price:+b.selling_price||0,stock:+b.stock||0,min_stock:+b.min_stock||0});
app.post('/api/products',auth('admin'),(q,r)=>{try{const p=pv(q.body);
 const id=db.transaction(()=>{const x=db.prepare('INSERT INTO products(barcode,name,category,cost_price,selling_price,stock,min_stock) VALUES(@barcode,@name,@category,@cost_price,@selling_price,@stock,@min_stock)').run(p).lastInsertRowid;
 if(p.stock>0)db.prepare("INSERT INTO stock_logs(product_id,type,qty,note) VALUES(?,'in',?,'Stok awal')").run(x,p.stock);return x;})();
 r.json({id});}catch(e){r.status(400).json({error:e.message});}});
app.put('/api/products/:id',auth('admin'),(q,r)=>{try{const old=db.prepare('SELECT * FROM products WHERE id=?').get(q.params.id);
 if(!old)return r.status(404).json({error:'Tidak ada'});const p={...pv({...old,...q.body}),id:old.id};
 db.transaction(()=>{db.prepare('UPDATE products SET barcode=@barcode,name=@name,category=@category,cost_price=@cost_price,selling_price=@selling_price,stock=@stock,min_stock=@min_stock WHERE id=@id').run(p);
 const d=p.stock-old.stock;if(d)db.prepare('INSERT INTO stock_logs(product_id,type,qty,note) VALUES(?,?,?,?)').run(old.id,d>0?'in':'out',Math.abs(d),q.body.note||'Penyesuaian admin');})();
 r.json({ok:true});}catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/products/:id',auth('admin'),(q,r)=>{db.prepare('DELETE FROM products WHERE id=?').run(q.params.id);r.json({ok:true});});
app.get('/api/stock-logs',auth('admin'),(q,r)=>r.json(db.prepare('SELECT s.*,p.name FROM stock_logs s LEFT JOIN products p ON p.id=s.product_id ORDER BY s.id DESC LIMIT 200').all()));

// items: [{product_id,qty}] atau manual [{name,price,qty}] (modal manual = 0)
app.post('/api/transactions',auth(),(q,r)=>{try{
 const{items,discount=0,cash_received=0,payment_method='cash',client_ref=null,invoice_number:invNo=null,created_at:at=null,offline=false}=q.body;
 if(client_ref){const ex=db.prepare('SELECT id FROM transactions WHERE client_ref=?').get(String(client_ref));if(ex)return r.json(receipt(ex.id));} // anti-dobel untuk kiriman ulang
 if(!Array.isArray(items)||!items.length)throw new Error('Keranjang kosong');
 const tx=db.transaction(()=>{let gross=0,cost=0,profit=0;const rows=[];
  for(const it of items){const qty=Math.floor(+it.qty);if(!(qty>0))throw new Error('Qty tidak valid');let row;
   const p=it.product_id?db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id):null;
   if(it.product_id&&!p&&!offline)throw new Error('Barang tidak ditemukan');
   if(p){if(p.stock<qty&&!offline)throw new Error(`Stok ${p.name} kurang (sisa ${p.stock})`);
    const sp=ok(+it.price)&&+it.price>=0?+it.price:p.selling_price;
    row={product_id:p.id,product_name:p.name,cost_price:p.cost_price,selling_price:sp,qty};
    db.prepare('UPDATE products SET stock=MAX(stock-?,0) WHERE id=?').run(qty,p.id);
    db.prepare("INSERT INTO stock_logs(product_id,type,qty,note) VALUES(?,'out',?,'Penjualan')").run(p.id,qty);
   }else{if(!it.name||!(+it.price>=0))throw new Error('Item manual tidak valid');
    row={product_id:null,product_name:it.name,cost_price:0,selling_price:Math.round(+it.price),qty};}
   row.subtotal=row.selling_price*qty;row.profit=(row.selling_price-row.cost_price)*qty;
   gross+=row.subtotal;cost+=row.cost_price*qty;profit+=row.profit;rows.push(row);}
  const disc=Math.min(Math.max(Math.round(+discount)||0,0),gross),total=gross-disc;
  const cash=payment_method==='cash'?Math.round(+cash_received):total;
  if(cash<total)throw new Error('Uang diterima kurang');
  const inv=/^[A-Za-z0-9-]{6,40}$/.test(invNo||'')&&!db.prepare('SELECT 1 FROM transactions WHERE invoice_number=?').get(invNo)?invNo:'INV'+new Date().toISOString().replace(/\D/g,'').slice(2,14)+crypto.randomInt(100,999);
  const id=db.prepare('INSERT INTO transactions(invoice_number,total_amount,total_cost,total_profit,discount,payment_method,cash_received,change_amount,user_id,client_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,COALESCE(?,datetime(\'now\',\'localtime\')))')
   .run(inv,total,cost,profit-disc,disc,payment_method,cash,cash-total,q.user.id,client_ref?String(client_ref):null,/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(at||'')?at:null).lastInsertRowid;
  const ins=db.prepare('INSERT INTO transaction_details(transaction_id,product_id,product_name,cost_price,selling_price,qty,subtotal,profit) VALUES(?,?,?,?,?,?,?,?)');
  rows.forEach(x=>ins.run(id,x.product_id,x.product_name,x.cost_price,x.selling_price,x.qty,x.subtotal,x.profit));
  return receipt(id);});
 r.json(tx());}catch(e){r.status(400).json({error:e.message});}});

function range(q){const l=n=>{const d=new Date(Date.now()-n*864e5);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
 const t=l(0);if(q.from&&q.to)return[q.from,q.to];
 return q.type==='weekly'?[l(6),t]:q.type==='monthly'?[t.slice(0,8)+'01',t]:[t,t];}
function report(q){const[from,to]=range(q);const a=[from+' 00:00:00',to+' 23:59:59'];
 const s=db.prepare('SELECT COUNT(*) trx,COALESCE(SUM(total_amount),0) revenue,COALESCE(SUM(total_cost),0) cost,COALESCE(SUM(total_profit),0) profit FROM transactions WHERE created_at BETWEEN ? AND ?').get(...a);
 const top=db.prepare('SELECT d.product_name name,SUM(d.qty) qty,SUM(d.subtotal) revenue,SUM(d.profit) profit FROM transaction_details d JOIN transactions t ON t.id=d.transaction_id WHERE t.created_at BETWEEN ? AND ? GROUP BY d.product_name ORDER BY qty DESC LIMIT 10').all(...a);
 const low=db.prepare('SELECT name,stock,min_stock FROM products WHERE stock<=min_stock ORDER BY stock').all();
 return{from,to,...s,top,low};}
app.get('/api/reports/summary',auth('admin'),(q,r)=>r.json(report(q.query)));
app.get('/api/reports/export',auth('admin'),(q,r)=>{const rep=report(q.query);
 rep.transactions=db.prepare('SELECT invoice_number,created_at,total_amount,total_cost,total_profit,payment_method FROM transactions WHERE created_at BETWEEN ? AND ? ORDER BY id').all(rep.from+' 00:00:00',rep.to+' 23:59:59');r.json(rep);});


// ===== Riwayat & cetak ulang struk =====
app.get('/api/transactions',auth(),(q,r)=>{const s=`%${String(q.query.q||'').replace(/[%_]/g,'')}%`;
 r.json(db.prepare(`SELECT t.id,t.invoice_number,t.total_amount,t.created_at,COALESCE(u.name,'-') cashier,(SELECT COUNT(*) FROM transaction_details WHERE transaction_id=t.id) items FROM transactions t LEFT JOIN users u ON u.id=t.user_id WHERE t.invoice_number LIKE ? ORDER BY t.id DESC LIMIT 50`).all(s));});
function receipt(id){
 const t=db.prepare("SELECT t.*,COALESCE(u.name,'(dihapus)') cashier FROM transactions t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=?").get(id);
 if(!t)return null;
 const items=db.prepare('SELECT product_name,selling_price,qty,subtotal FROM transaction_details WHERE transaction_id=?').all(t.id);
 return{id:t.id,invoice_number:t.invoice_number,total:t.total_amount,discount:t.discount,cash_received:t.cash_received,change:t.change_amount,items,cashier:t.cashier,created_at:new Date(t.created_at.replace(' ','T')).toLocaleString('id-ID')};}
app.get('/api/transactions/:id',auth(),(q,r)=>{const x=receipt(q.params.id);x?r.json(x):r.status(404).json({error:'Transaksi tidak ditemukan'});});

// ===== Pengaturan printer & struk (dipakai bersama semua perangkat) =====
const DEF={name:'Toko Serba Ada',address:'Alamat toko',footer:'Terima kasih atas kunjungan Anda',width:32,method:'bluetooth',auto:false};
const getSettings=()=>{const o={...DEF};for(const x of db.prepare('SELECT * FROM settings').all())if(x.key in DEF)try{o[x.key]=JSON.parse(x.value)}catch{}return o;};
app.get('/api/settings',auth(),(q,r)=>r.json(getSettings()));
app.put('/api/settings',auth(),(q,r)=>{const b=q.body||{},n=getSettings();
 for(const k of ['name','address','footer'])if(typeof b[k]==='string')n[k]=b[k].trim().slice(0,k==='name'?60:120);
 if([32,48].includes(+b.width))n.width=+b.width;
 if(['bluetooth','rawbt'].includes(b.method))n.method=b.method;
 if(typeof b.auto==='boolean')n.auto=b.auto;
 if(!n.name)return r.status(400).json({error:'Nama toko wajib diisi'});
 db.transaction(()=>{const s=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const k of Object.keys(DEF))s.run(k,JSON.stringify(n[k]));})();
 r.json(getSettings());});

// ===== Backup & reset data operasional (akun pengguna tidak disertakan) =====
const backupTables=['products','stock_logs','transactions','transaction_details','settings'];
app.get('/api/backup',auth('admin'),(q,r)=>{
 const tables=Object.fromEntries(backupTables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
 r.json({format:'pos-toko-backup',version:1,exported_at:new Date().toISOString(),tables});
});
app.post('/api/backup/import',auth('admin'),(q,r)=>{try{
 const b=q.body||{},tables=b.tables;
 if(b.format!=='pos-toko-backup'||b.version!==1||!tables||backupTables.some(t=>!Array.isArray(tables[t])))throw new Error('File backup tidak valid atau versinya tidak didukung');
 const cols=Object.fromEntries(backupTables.map(t=>[t,db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name)]));
 for(const t of backupTables)for(const row of tables[t]){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!cols[t].includes(k)))throw new Error('Format data '+t+' tidak valid');
 }
 if(tables.settings.some(x=>typeof x.key!=='string'||typeof x.value!=='string'))throw new Error('Format pengaturan tidak valid');
 db.transaction(()=>{
  for(const t of ['transaction_details','transactions','stock_logs','products','settings'])db.prepare(`DELETE FROM ${t}`).run();
  for(const t of ['products','transactions','transaction_details','stock_logs','settings'])for(const row of tables[t]){
   const keys=Object.keys(row);if(!keys.length)continue;
   const sql=`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;
   db.prepare(sql).run(...keys.map(k=>row[k]));
  }
 })();r.json({ok:true});
 }catch(e){r.status(400).json({error:e.message});}});
app.delete('/api/backup/:scope',auth('admin'),(q,r)=>{
 const actions={products:['stock_logs','products'],transactions:['transaction_details','transactions'],settings:['settings'],all:['transaction_details','transactions','stock_logs','products','settings']};
 const list=actions[q.params.scope];if(!list)return r.status(400).json({error:'Pilihan data tidak valid'});
 db.transaction(()=>{for(const t of list)db.prepare(`DELETE FROM ${t}`).run();})();r.json({ok:true});});

// ===== Manajemen pengguna (khusus admin) =====
const uErr=(r,m,c=400)=>r.status(c).json({error:m});
const adminCount=()=>db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
function uVal(b,creating){const name=String(b.name||'').trim(),un=String(b.username||'').trim().toLowerCase();
 if(!name||!un)return 'Nama dan username wajib diisi';
 if(!/^[a-z0-9_.-]{3,30}$/.test(un))return 'Username 3-30 karakter (huruf, angka, _ . -)';
 if(!['admin','karyawan'].includes(b.role))return 'Role tidak valid';
 if((creating||b.password)&&String(b.password||'').length<4)return 'Password minimal 4 karakter';return null;}
const dup=x=>/UNIQUE/.test(x.message)?'Username sudah dipakai':x.message;
app.get('/api/users',auth('admin'),(q,r)=>r.json(db.prepare('SELECT id,name,username,role FROM users ORDER BY id').all()));
app.post('/api/users',auth('admin'),(q,r)=>{const b=q.body||{},e=uVal(b,true);if(e)return uErr(r,e);
 try{r.json({id:db.prepare('INSERT INTO users(name,username,password,role) VALUES(?,?,?,?)').run(b.name.trim(),b.username.trim().toLowerCase(),hash(b.password),b.role).lastInsertRowid});}catch(x){uErr(r,dup(x));}});
app.put('/api/users/:id',auth('admin'),(q,r)=>{const id=+q.params.id,old=db.prepare('SELECT * FROM users WHERE id=?').get(id),b=q.body||{};
 if(!old)return uErr(r,'Pengguna tidak ditemukan',404);const e=uVal(b,false);if(e)return uErr(r,e);
 if(old.role==='admin'&&b.role!=='admin'&&adminCount()<2)return uErr(r,'Minimal harus ada 1 admin');
 const name=b.name.trim();
 try{db.prepare('UPDATE users SET name=?,username=?,role=? WHERE id=?').run(name,b.username.trim().toLowerCase(),b.role,id);
  if(b.password)db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(b.password),id);}catch(x){return uErr(r,dup(x));}
 const self=id===q.user.id;
 for(const[t,s]of sessions)if(s.id===id){if(self||!(b.password||b.role!==old.role))Object.assign(s,{name,role:b.role});else sessions.delete(t);}
 r.json({ok:true,self:self?{id,name,role:b.role}:null});});
app.delete('/api/users/:id',auth('admin'),(q,r)=>{const id=+q.params.id,u=db.prepare('SELECT * FROM users WHERE id=?').get(id);
 if(!u)return uErr(r,'Pengguna tidak ditemukan',404);
 if(id===q.user.id)return uErr(r,'Tidak bisa menghapus akun yang sedang dipakai');
 if(u.role==='admin'&&adminCount()<2)return uErr(r,'Minimal harus ada 1 admin');
 db.prepare('DELETE FROM users WHERE id=?').run(id);for(const[t,s]of sessions)if(s.id===id)sessions.delete(t);r.json({ok:true});});

// Semua error /api dijawab dalam JSON (bukan halaman HTML)
app.use('/api',(q,r)=>r.status(404).json({error:'Endpoint tidak ditemukan. Pastikan server.js versi terbaru dan server sudah di-restart'}));
app.use((e,q,r,n)=>r.status(e.status||500).json({error:e.message}));
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('POS server: http://localhost:'+PORT+'  (login awal admin/admin123, kasir/kasir123)'));
