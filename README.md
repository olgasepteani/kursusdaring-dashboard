# Dashboard Monitoring Kursus Daring LKP

Dashboard monitoring untuk seluruh Lembaga Kursus dan Pelatihan (LKP) pengguna
**Platform Kursus Daring**, dibangun untuk Direktorat Kursus dan Pelatihan.

- **Frontend**: HTML5, Bootstrap 5, Chart.js, DataTables, Leaflet (peta), SweetAlert2, FontAwesome — hosting gratis di **GitHub Pages**
- **Backend**: Google Apps Script sebagai REST API di atas **Google Spreadsheet** (tanpa server berbayar, tanpa Firebase)
- **Mode Demo bawaan**: dashboard bisa langsung dijalankan/di-preview memakai data contoh (`data/lkp_data.json`, hasil olahan file Excel yang Anda lampirkan — 12.883 LKP) tanpa perlu deploy Apps Script terlebih dahulu

---

## 1. Struktur folder

```
/
├── index.html              # Dashboard utama (statistik, grafik, peta, tabel, filter)
├── admin.html               # Login + panel admin (CRUD LKP & Kelas, import/export Excel)
├── css/
│   └── style.css            # Design system (warna, komponen, dark/light mode)
├── js/
│   ├── common.js            # Util bersama: tema, sidebar mobile, spinner, toast
│   ├── api.js                # Lapisan komunikasi ke Apps Script + mode demo
│   ├── filter.js             # State & logika filter realtime
│   ├── charts.js             # Semua grafik Chart.js
│   ├── map.js                 # Peta choropleth Indonesia (Leaflet) + fallback
│   ├── excel.js               # Download/upload Excel (SheetJS)
│   ├── dashboard.js           # Controller index.html
│   └── admin.js                # Controller admin.html
├── apps-script/
│   └── Code.gs                # Backend REST API (Google Apps Script)
├── data/
│   ├── lkp_data.json          # Dataset hasil olahan Excel Anda (dipakai mode demo)
│   ├── seed_LKP.csv           # Untuk diimpor ke tab "LKP" pada Google Spreadsheet
│   ├── seed_Kelas.csv         # Untuk diimpor ke tab "Kelas"
│   └── seed_Referensi.csv     # Untuk diimpor ke tab "Referensi"
└── README.md
```

---

## 2. Menjalankan cepat (Mode Demo, tanpa backend)

`js/api.js` memiliki `CONFIG.API_URL`. Selama nilainya kosong (`""`), dashboard
otomatis berjalan dalam **mode demo**: semua data dibaca dari `data/lkp_data.json`
dan aksi CRUD di Admin Panel hanya tersimpan sementara di memori browser
(kembali seperti semula saat halaman dimuat ulang). Ini memudahkan Anda melihat
tampilan dashboard secara utuh sebelum menyiapkan backend.

- Login demo di Admin Panel: **username `admin` / password `admin123`**
- Cukup buka `index.html` melalui GitHub Pages (lihat langkah §4) atau server
  statis lokal apa pun (`python3 -m http.server`) — jangan buka lewat `file://`
  langsung karena `fetch()` ke `data/lkp_data.json` akan diblokir browser.

---

## 3. Menyiapkan backend (Google Apps Script + Google Spreadsheet)

### 3.1 Buat Google Spreadsheet baru
1. Buka [sheets.new](https://sheets.new), beri nama misalnya **"DB Kursus Daring LKP"**.
2. Buka menu **Extensions > Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu salin-tempel seluruh isi file
   [`apps-script/Code.gs`](apps-script/Code.gs) dari proyek ini.
4. Simpan project (nama bebas, misalnya "Kursus Daring API").

### 3.2 Inisialisasi struktur sheet
1. Di editor Apps Script, pilih fungsi **`setupSpreadsheet`** pada dropdown
   fungsi di toolbar, lalu klik **Run**. Izinkan permission yang diminta.
2. Ini akan membuat 4 tab: `LKP`, `Kelas`, `Log`, `Referensi`, sekaligus
   menyimpan kredensial admin default (`admin` / `admin123`) di
   **Project Settings > Script Properties** — silakan ubah nilainya di sana.

### 3.3 Impor data awal dari Excel Anda
Cara termudah — impor CSV langsung lewat Google Sheets:
1. Di spreadsheet, buka tab **LKP** → menu **File > Import > Upload** →
   pilih `data/seed_LKP.csv` → pilih opsi **"Replace current sheet"**.
2. Ulangi untuk tab **Kelas** dengan file `data/seed_Kelas.csv`.
3. Ulangi untuk tab **Referensi** dengan file `data/seed_Referensi.csv`.

> File CSV ini sudah dihasilkan dari file Excel `LKP_Kursus_daring_bimtek.xlsx`
> yang Anda lampirkan, dengan struktur "satu LKP satu baris, kelas sebagai
> data anak" sesuai permintaan Anda.

### 3.4 Deploy sebagai Web App
1. Di editor Apps Script: **Deploy > New deployment**.
2. Pilih tipe **Web app**.
3. **Execute as**: *Me*. **Who has access**: *Anyone*.
4. Klik **Deploy**, salin **Web app URL** yang muncul (formatnya
   `https://script.google.com/macros/s/AKfycb.../exec`).
5. Setiap kali Anda mengubah `Code.gs`, buat **New deployment** baru (atau
   gunakan **Manage deployments > Edit > New version**) agar perubahan aktif.

### 3.5 Hubungkan frontend ke backend
Buka `js/api.js`, isi:
```js
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxx/exec",
  AUTH_KEY: "lkp_dashboard_auth_token",
};
```
Simpan, lalu commit & push — mode demo otomatis nonaktif dan dashboard akan
membaca/menulis langsung ke Google Spreadsheet Anda.

---

## 4. Deploy ke GitHub Pages

1. Buat repository baru di GitHub, misalnya `kursusdaring-dashboard`.
2. Unggah seluruh isi folder proyek ini ke repository tersebut (root repo,
   bukan di dalam subfolder), lalu commit.
3. Buka **Settings > Pages** pada repository.
4. Pada **Source**, pilih branch `main` dan folder `/ (root)`, lalu **Save**.
5. Tunggu 1–2 menit, dashboard akan dapat diakses di:
   `https://<username-anda>.github.io/kursusdaring-dashboard/`

Karena seluruh frontend adalah file statis (HTML/CSS/JS) dan backend berjalan
di Google Apps Script, GitHub Pages sudah cukup — tidak perlu server tambahan.

---

## 5. Fitur yang sudah tersedia

**Dashboard (`index.html`)**
- 10 kartu statistik realtime (jumlah LKP, provinsi, kab/kota, kelas, peserta,
  lulusan, sudah/belum bimtek, kelas berjalan/belum lengkap)
- 7 grafik Chart.js: LKP per provinsi, kelas per program, status kelas, status
  bimtek, peserta vs lulusan per provinsi, top 10 provinsi, top 10 kab/kota
- Peta choropleth interaktif Indonesia (Leaflet) — klik provinsi untuk
  memfilter data; otomatis beralih ke daftar peringkat bila sumber peta tidak
  dapat dimuat (mis. jaringan memblokir domain eksternal)
- Tabel DataTables dengan pencarian, sorting, pagination
- Filter realtime yang dapat digabung: provinsi, kab/kota, program
  keterampilan, status bimtek, status kelas, tahun bimtek, minimum
  peserta/lulusan, kata kunci — dan dapat dibagikan lewat tautan (query
  string tersimpan otomatis)
- Modal detail LKP: identitas lengkap + daftar seluruh kelas dengan status,
  tautan, jumlah peserta & lulusan
- Download Excel dari hasil tabel yang sedang difilter (SheetJS)
- Mode gelap/terang, sidebar responsif untuk mobile/tablet

**Admin Panel (`admin.html`)**
- Login sederhana berbasis token (tanpa OAuth)
- Tambah / edit / hapus data LKP beserta daftar kelasnya dalam satu form
- Import massal dari file Excel (menambahkan LKP baru)
- Export seluruh data ke Excel
- Setiap aksi CRUD otomatis tersimpan ke Google Spreadsheet & tercatat di
  tab `Log` (audit trail dasar: waktu, pengguna, aksi)

**Status kelas dihitung otomatis** berdasarkan jumlah peserta & kelengkapan
materi (hijau/kuning/merah), dan **status bimtek** menampilkan tahun bimtek
bila sudah pernah, atau "Belum Pernah Bimtek".

---

## 6. Ide pengembangan lanjutan

Beberapa hal berikut dapat ditambahkan sesuai kebutuhan lebih lanjut karena
di luar cakupan inti dashboard ini: ekspor PDF khusus (saat ini gunakan
Ctrl+P/print bawaan browser pada tabel), indikator kualitas data otomatis
(tautan kelas tidak valid dsb.), dan panel KPI capaian nasional yang lebih
mendalam. Struktur kode modular (`js/*.js` terpisah per fungsi,
`apps-script/Code.gs` dengan fungsi CRUD terisolasi) dirancang agar mudah
dikembangkan lebih lanjut.

---

## 7. Kredensial & keamanan

Backend memakai autentikasi sederhana (username/password disimpan di Script
Properties, token sesi disimpan di CacheService selama 6 jam) — cukup untuk
kebutuhan internal, namun bukan pengganti OAuth/2FA untuk data sensitif skala
besar. Ganti password default sebelum digunakan secara produksi, dan
pertimbangkan membatasi **Who has access** pada deployment Apps Script jika
seluruh pengguna berada dalam satu organisasi Google Workspace.
