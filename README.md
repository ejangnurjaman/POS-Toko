# POS Toko

Aplikasi kasir berbasis web untuk mengelola penjualan dan operasional toko. Server Node.js menyajikan antarmuka web dan API, sementara data utama disimpan dalam database SQLite. Aplikasi dapat dibuka dari komputer maupun browser ponsel melalui jaringan lokal.

> Proyek ini adalah web app. Belum ada paket APK, PWA/service worker, atau proses build frontend.

## Fitur

- Kasir dengan katalog, pencarian nama/barcode, keranjang, diskon, pembayaran tunai, dan hitung kembalian.
- Transaksi barang tersimpan ke database; barang manual juga dapat dimasukkan ke keranjang.
- Riwayat transaksi, pencarian nomor invoice, detail, dan cetak ulang struk.
- Manajemen barang untuk admin: barcode/SKU, kategori, harga modal dan jual, stok, serta batas stok minimum.
- Ringkasan penjualan harian, mingguan, dan bulanan; laporan dengan rentang tanggal, produk terlaris, dan ekspor PDF/JPG.
- Pengaturan nama/alamat toko, footer struk, lebar kertas 58/80 mm, Bluetooth atau RawBT, dan cetak otomatis.
- Manajemen akun admin dan kasir.
- Ekspor/impor backup data operasional melalui menu Pengaturan.
- Antrean transaksi offline berbasis IndexedDB, cache barang di perangkat, dan sinkronisasi otomatis saat server kembali terjangkau.
- Tampilan terang/gelap dan akses multi-perangkat melalui jaringan lokal.

## Kebutuhan

- Node.js 18 atau lebih baru dan npm.
- Browser modern. Untuk koneksi printer Bluetooth langsung, gunakan browser/perangkat yang mendukung Web Bluetooth dan konteks aman (HTTPS atau `localhost`). RawBT tersedia sebagai alternatif pada perangkat Android.
- Koneksi internet saat instalasi dependency npm. PDF/JPG dan QR memakai library dari CDN, sehingga fitur tersebut memerlukan internet kecuali library disajikan lokal.

## Menjalankan di komputer

Dari folder proyek, jalankan:

```bash
npm ci
npm start
```

> `npm ci` menggunakan `package-lock.json` untuk instalasi yang konsisten. Jika lockfile tidak tersedia, gunakan `npm install`.

Buka [http://localhost:3000](http://localhost:3000) di browser pada komputer yang menjalankan server.

Saat pertama kali database pengguna masih kosong, aplikasi membuat akun awal berikut:

| Peran | Username | Password |
| --- | --- | --- |
| Admin / Owner | `admin` | `admin123` |
| Karyawan / Kasir | `kasir` | `kasir123` |

Segera ubah password awal dan tinjau akun dari **Pengaturan → Pengguna**. Akun awal hanya dibuat saat database belum memiliki pengguna.

## Membuka dari ponsel

1. Sambungkan komputer server dan ponsel ke Wi-Fi atau hotspot yang sama.
2. Pastikan firewall komputer mengizinkan koneksi masuk ke port `3000`.
3. Dari ponsel, buka alamat IP komputer dengan port server, misalnya `http://192.168.1.20:3000`.
4. Admin dapat melihat alamat server dan QR pada menu **Pengaturan**. Kasir memasukkan alamat server tersebut pada layar login jika belum terisi.

> Alamat HTTP ini ditujukan untuk jaringan lokal tepercaya. Browser dapat membatasi Bluetooth pada HTTP non-`localhost`; gunakan HTTPS atau RawBT bila diperlukan.

## Konfigurasi server

Server membaca konfigurasi berikut dari environment:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP server. Server menerima koneksi pada semua antarmuka jaringan. |
| `DB_PATH` | `pos.db` | Lokasi file SQLite. Path relatif dihitung dari direktori kerja saat `npm start` dijalankan. |

Contoh Linux/macOS untuk memakai port lain:

```bash
PORT=3001 npm start
```

Contoh memakai direktori database khusus (direktori harus dibuat terlebih dahulu):

```bash
mkdir -p data
DB_PATH=./data/pos.db npm start
```

Tidak ada langkah kompilasi frontend: `server.js` menyajikan `public/index.html`, aset statis, dan endpoint API. Untuk menghentikan server, tekan `Ctrl+C` pada terminal tempat server berjalan.

## Peran pengguna

| Kemampuan | Admin | Karyawan |
| --- | :---: | :---: |
| Kasir dan melihat riwayat transaksi | Ya | Ya |
| Mengelola barang dan stok | Ya | Tidak |
| Melihat ringkasan dan laporan | Ya | Tidak |
| Mengelola pengguna | Ya | Tidak |
| Mengubah pengaturan toko dan printer | Ya | Ya |
| Ekspor/impor backup dan hapus data operasional | Ya | Tidak |

## Mode offline

Jika modul Dexie di `public/vendor/dexie.js` berhasil dimuat, halaman kasir menyimpan cache barang dan transaksi yang dibuat saat API server tidak terjangkau di IndexedDB lokal browser (`PosLocalDB`). Antrean dicoba sinkron setiap 10 detik dan ketika koneksi kembali. Pengiriman ulang memakai referensi transaksi agar transaksi yang sama tidak tercatat dua kali di server.

- Browser perlu dibuka dan data barang perlu pernah dimuat ketika server terjangkau agar cache tersedia. Ini bukan berarti aplikasi dapat selalu dibuka dari awal tanpa jaringan: proyek belum memakai service worker untuk menyimpan seluruh halaman/aset.
- Antrean offline melekat pada profil browser dan perangkat, bukan database server. Jangan menghapus data situs/browser sebelum transaksi pending berhasil tersinkron atau sudah dicadangkan.
- Ketika transaksi berlangsung offline di beberapa perangkat, stok belum divalidasi secara real-time oleh server. Periksa kembali stok setelah semua perangkat tersinkron.
- Jika modul Dexie gagal dimuat, aplikasi tetap dapat dipakai saat online tetapi antrean offline tidak aktif. Periksa file `public/vendor/dexie.js` dan konsol browser.
- Backup dari menu aplikasi menyertakan data server serta antrean/cache offline pada perangkat yang membuat backup. Data offline perangkat lain tidak ikut tercakup.

## Printer dan laporan

Konfigurasi struk disimpan bersama pengaturan toko dan dibagikan ke perangkat lain. Koneksi Bluetooth dilakukan per perangkat. Web Bluetooth biasanya mensyaratkan HTTPS atau `localhost`; akses melalui IP lokal HTTP dapat dibatasi browser. Pilihan RawBT membutuhkan aplikasi RawBT yang kompatibel pada perangkat.

Ekspor laporan PDF/JPG dan pembuatan QR menggunakan library CDN yang dimuat dari Cloudflare CDN. Jika fitur tersebut tidak tersedia, pastikan perangkat memiliki akses internet. Fitur kasir dasar dan server tidak membutuhkan proses build frontend.

## Backup dan penyimpanan data

- File database default berada di `pos.db` pada direktori kerja server. Database dibuat otomatis saat server dijalankan.
- Admin dapat mengunduh dan mengimpor backup JSON dari **Pengaturan → Database**. Impor mengganti barang, log stok, transaksi, detail transaksi, dan pengaturan; akun pengguna tidak diubah.
- Backup aplikasi lebih disarankan untuk pemindahan/pemulihan data. Jika menyalin file SQLite secara manual, hentikan server terlebih dahulu agar file database konsisten.
- Simpan salinan backup di lokasi terpisah dari komputer server dan uji pemulihan secara berkala.

## Struktur proyek

```text
.
├── server.js                 # Server Express, API, autentikasi, dan SQLite
├── package.json              # Dependency dan perintah npm
├── package-lock.json         # Versi dependency terkunci
├── pos.db                    # Database runtime (dibuat saat server berjalan)
└── public/
	├── index.html            # Antarmuka web
	├── js/
	│   ├── export.js         # Ekspor laporan
	│   ├── offlineQueue.js   # Cache dan antrean transaksi offline
	│   └── printer.js        # Penyusunan/cetak struk
	├── svg/                  # Ikon antarmuka
	└── vendor/               # Library vendor, termasuk Dexie
```

## Keamanan dan batas penggunaan

- Ganti kedua password bawaan sebelum digunakan. Hash password saat ini memakai SHA-256 dengan salt tetap; ini bukan mekanisme password hashing yang sesuai untuk layanan publik atau data sensitif.
- Token sesi hanya disimpan di memori server. Restart server mengakhiri sesi aktif dan pengguna perlu login kembali.
- API mengaktifkan CORS untuk semua origin dan server menggunakan HTTP biasa. Jangan membuka port aplikasi langsung ke internet atau menggunakannya untuk data sensitif tanpa memperkuat autentikasi, penyimpanan password, HTTPS, pembatasan jaringan, dan kebijakan CORS.
- Gunakan hanya pada perangkat/jaringan yang dipercaya, batasi akses firewall ke jaringan toko, lindungi komputer server, dan buat backup rutin.
- Proyek ini belum menyediakan suite test otomatis atau pipeline build; verifikasi perubahan dengan menjalankan aplikasi dan menguji alur yang terdampak.

## Teknologi

Node.js, Express, SQLite melalui `better-sqlite3`, HTML/CSS/JavaScript, dan Dexie/IndexedDB untuk data offline lokal.
