// Cetak struk ESC/POS: Web Bluetooth langsung atau RawBT (rawbt:base64,...)
const Printer=(()=>{
 let ch=null;const enc=new TextEncoder(),ESC=0x1b,GS=0x1d;
 const rp=n=>'Rp'+Number(n).toLocaleString('id-ID');
 function build(t,shop,width=32,copy=false){ // width: 32 = 58mm, 48 = 80mm
  const b=[ESC,0x40],add=s=>b.push(...enc.encode(s)),line=(l,r)=>add(l+' '.repeat(Math.max(1,width-l.length-r.length))+r+'\n'),
  sep=()=>add('-'.repeat(width)+'\n'),al=n=>b.push(ESC,0x61,n);
  al(1);b.push(ESC,0x45,1);add(shop.name+'\n');b.push(ESC,0x45,0);add((shop.address||'')+'\n');if(copy){b.push(ESC,0x45,1);add('** CETAK ULANG **\n');b.push(ESC,0x45,0);}al(0);sep();
  add(t.invoice_number+'\n'+t.created_at+'\nKasir: '+t.cashier+'\n');sep();
  t.items.forEach(i=>{add(i.product_name.slice(0,width)+'\n');line(` ${i.qty} x ${Number(i.selling_price).toLocaleString('id-ID')}`,rp(i.subtotal));});
  sep();if(t.discount)line('Diskon','-'+rp(t.discount));
  b.push(ESC,0x45,1);line('TOTAL',rp(t.total));b.push(ESC,0x45,0);
  line('Bayar',rp(t.cash_received));line('Kembali',rp(t.change));sep();
  al(1);add((shop.footer||'Terima kasih atas kunjungan Anda')+'\n\n\n');b.push(GS,0x56,0x00);
  return new Uint8Array(b);}
 async function connect(){
  const S=['000018f0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb','e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
  const d=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:S});
  const srv=await d.gatt.connect();
  for(const s of await srv.getPrimaryServices())for(const c of await s.getCharacteristics())
   if(c.properties.write||c.properties.writeWithoutResponse){ch=c;return d.name;}
  throw new Error('Karakteristik tulis tidak ditemukan');}
 async function printBT(bytes){if(!ch)await connect();
  for(let i=0;i<bytes.length;i+=100){const p=bytes.slice(i,i+100);
   ch.properties.writeWithoutResponse?await ch.writeValueWithoutResponse(p):await ch.writeValue(p);await new Promise(r=>setTimeout(r,30));}}
 function printRawBT(bytes){let s='';bytes.forEach(x=>s+=String.fromCharCode(x));location.href='rawbt:base64,'+btoa(s);}
 return{build,connect,printBT,printRawBT};})();
