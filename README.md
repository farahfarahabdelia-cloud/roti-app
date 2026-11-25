# Aplikasi Penjualan Roti (Sales + Bos, terhubung lewat server)

Dua aplikasi dalam satu server:
- `/sales`  : aplikasi sales (Thoriq, Bogel, Balo). Masuk pakai PIN, sekali per hari.
- `/boss`   : dashboard bos. Laporan masuk langsung (real-time), rekap per sales, atur harga & PIN.

Keduanya bisa dipasang ke layar HP seperti aplikasi biasa (lihat bagian "Pasang di HP").

## Menjalankan (butuh Node.js 18 atau lebih baru; tanpa instal paket lain)

    BOSS_PASSWORD=passwordbos node server.js

Lalu buka http://localhost:3000/boss.
Windows (PowerShell):

    $env:BOSS_PASSWORD="passwordbos"; node server.js

Pengaturan (environment variable, semua opsional):
- `BOSS_PASSWORD` : password bos. Jika kosong, dibuat otomatis dan dicetak di layar saat pertama jalan.
- `PORT`          : default 3000.
- `SALES`         : daftar nama sales, default `Thoriq,Bogel,Balo`.
- `DATA_DIR`      : folder penyimpanan data (default `./data`). WAJIB disimpan permanen, lihat di bawah.

## Langkah pertama setelah jalan
1. Buka `/boss`, masuk dengan password bos.
2. Isi harga roti panjang dan petak, klik Simpan harga.
3. Isi PIN 4 angka untuk tiap sales, klik Simpan PIN. Sales belum bisa masuk sebelum PIN diatur.
4. Beri sales alamat `https://alamat-anda/sales`.

## Agar bisa dibuka dari HP sales (perlu server online)
Server harus bisa diakses internet dan memakai HTTPS (agar bisa dipasang sebagai aplikasi).
Pilihan yang mudah:
- VPS kecil (mis. Niagahoster, IDCloudHost, DigitalOcean) + Node.js, jalankan dengan `pm2` atau `systemd`, pasang Caddy/Nginx untuk HTTPS.
- Layanan hosting Node seperti Railway, Render, atau Fly.io: unggah folder ini, perintah mulai `node server.js`.
  Pasang "volume/disk" permanen lalu arahkan `DATA_DIR` ke sana, kalau tidak data hilang saat server restart.

Untuk mencoba di jaringan Wi-Fi yang sama tanpa hosting: jalankan di komputer, buka `http://IP-komputer:3000/sales` dari HP
(tanpa HTTPS, jadi hanya bisa dibuka lewat browser, belum bisa dipasang sebagai aplikasi).

## Pasang di HP (setelah ada HTTPS)
- Android (Chrome): buka `/sales` atau `/boss`, menu titik tiga, "Instal aplikasi" / "Tambahkan ke layar utama".
- iPhone (Safari): tombol Bagikan, "Tambah ke Layar Utama".

## Keamanan
- PIN sales disimpan sebagai hash (scrypt), password bos dicek di server.
- Salah PIN/password 5 kali: dikunci 15 menit.
- Sesi sales berakhir tengah malam WIB (PIN diminta lagi besok). Sesi bos 30 hari.
- Data disimpan di `DATA_DIR/db.json`. Cadangkan file ini secara berkala.
- Pakai HTTPS di server publik.

## Pasang di cPanel (mis. Domainesia) lewat "Setup Node.js App"
1. Di cPanel buka **Setup Node.js App**, klik **Create Application**.
   - Node.js version: 18 atau lebih baru
   - Application mode: Production
   - Application root: `roti-app`
   - Application URL: subdomain, mis. `roti.namadomain.com`
   - Application startup file: `server.js`
2. Unggah isi folder ini (File Manager) ke folder `roti-app` di home hosting. Jangan unggah folder `data`.
3. Di halaman aplikasi, bagian Environment variables, tambahkan `BOSS_PASSWORD` (password bos Anda). Klik Save.
4. Aktifkan SSL gratis (AutoSSL) untuk subdomain tersebut di menu SSL/TLS Status.
5. Klik **Restart**, lalu buka `https://roti.namadomain.com/boss`.
Folder `data` (berisi `db.json`) dibuat otomatis di dalam folder aplikasi. Cadangkan berkala lewat File Manager.
