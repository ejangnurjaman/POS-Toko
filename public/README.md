# POS Toko — Testing di PC
1. Install Node.js 18+ lalu: `cd pos-app && npm install && npm start`
2. Buka http://localhost:3000 — login `admin/admin123` (Owner) atau `kasir/kasir123` (Karyawan). **Ganti password segera.**
3. Tes dari HP: satu Wi-Fi/hotspot, buka `http://IP-PC:3000` (IP tampil di tab Server + QR). Izinkan port 3000 di firewall.
4. Bluetooth printing butuh HTTPS/localhost atau WebView Capacitor; alternatifnya RawBT.

# Lanjut ke APK (Capacitor)
- `npm i @capacitor/core @capacitor/cli @capacitor/android && npx cap init && npx cap add android`, `webDir: public`.
- Server Node di Android: pakai plugin **capacitor-nodejs** / nodejs-mobile (jalankan server.js di dalam app) dan ganti better-sqlite3 ke build Android-nya (atau @capacitor-community/sqlite). Ini bagian tersulit; test terpisah dulu.
- Mode Karyawan: cukup WebView yang mengarah ke IP Admin (kolom "Alamat server" di login).
- Unduh library CDN ke `public/vendor/` agar benar-benar offline. Izinkan cleartext HTTP: `server.cleartext: true` di capacitor.config.
- Scan QR kamera: tambahkan @capacitor-mlkit/barcode-scanning (belum termasuk).
