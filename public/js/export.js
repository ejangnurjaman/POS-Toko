// Butuh jsPDF, jspdf-autotable, html2canvas (dimuat di index.html)
const Exporter=(()=>{
 const rp=n=>'Rp '+Number(n||0).toLocaleString('id-ID');
 function pdf(rep,shop='Toko'){const{jsPDF}=window.jspdf,d=new jsPDF();
  d.setFontSize(14);d.text('Laporan Penjualan - '+shop,14,15);d.setFontSize(10);d.text(`Periode: ${rep.from} s/d ${rep.to}`,14,22);
  d.autoTable({startY:27,head:[['Omset','Modal','Keuntungan','Transaksi']],body:[[rp(rep.revenue),rp(rep.cost),rp(rep.profit),rep.trx]]});
  d.autoTable({startY:d.lastAutoTable.finalY+6,head:[['Barang Terlaris','Qty','Omset','Profit']],body:rep.top.map(t=>[t.name,t.qty,rp(t.revenue),rp(t.profit)])});
  if(rep.transactions)d.autoTable({startY:d.lastAutoTable.finalY+6,head:[['Invoice','Waktu','Total','Modal','Profit']],body:rep.transactions.map(t=>[t.invoice_number,t.created_at,rp(t.total_amount),rp(t.total_cost),rp(t.total_profit)])});
  d.save(`laporan_${rep.from}_${rep.to}.pdf`);}
 async function image(el,name='laporan',type='png'){
  const h=document.documentElement,was=h.classList.contains('dark');h.classList.remove('dark');
  const c=await html2canvas(el,{scale:2,backgroundColor:'#fff'});if(was)h.classList.add('dark');const a=document.createElement('a');
  a.href=c.toDataURL(type==='jpg'?'image/jpeg':'image/png',.95);a.download=`${name}.${type}`;a.click();}
 return{pdf,image};})();
