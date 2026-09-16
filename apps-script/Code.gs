/**
 * ============================================================================
 * Code.gs — Backend REST API untuk Dashboard Monitoring Kursus Daring LKP
 * ============================================================================
 * Deploy sebagai Web App:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Struktur Google Spreadsheet (dibuat otomatis oleh fungsi setupSpreadsheet
 * jika sheet belum ada — jalankan sekali dari editor Apps Script):
 *
 *   Sheet "LKP"
 *     id | npsn | nama_lkp | alamat | provinsi | kab_kota | program_keterampilan
 *     | status_bimtek | tahun_bimtek | catatan | created_at | updated_at
 *
 *   Sheet "Kelas"
 *     id | lkp_id | nama_kelas | link | peserta | lulusan | status
 *
 *   Sheet "Log"
 *     timestamp | username | action | detail
 *
 *   Sheet "Referensi"
 *     tipe | nilai            (tipe = "provinsi" | "program")
 * ============================================================================
 */

const SHEET_LKP = "LKP";
const SHEET_KELAS = "Kelas";
const SHEET_LOG = "Log";
const SHEET_REF = "Referensi";

/* ---------------------------------------------------------------------- */
function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name, headers) {
  const ss = getSS();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Jalankan sekali secara manual dari editor Apps Script untuk inisialisasi sheet */
function setupSpreadsheet() {
  getOrCreateSheet(SHEET_LKP, ["id", "npsn", "nama_lkp", "alamat", "provinsi", "kab_kota", "program_keterampilan", "status_bimtek", "tahun_bimtek", "catatan", "created_at", "updated_at", "status_moodle"]);
  getOrCreateSheet(SHEET_KELAS, ["id", "lkp_id", "nama_kelas", "link", "peserta", "lulusan", "status", "program_keterampilan"]);
  getOrCreateSheet(SHEET_LOG, ["timestamp", "username", "action", "detail"]);
  getOrCreateSheet(SHEET_REF, ["tipe", "nilai"]);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("ADMIN_USERNAME")) props.setProperty("ADMIN_USERNAME", "admin");
  if (!props.getProperty("ADMIN_PASSWORD")) props.setProperty("ADMIN_PASSWORD", "admin123");
}

/**
 * Import awal dari data/lkp_data.json (jalankan sekali secara manual setelah
 * setupSpreadsheet, dengan isi variabel SEED di bawah — lihat README.md
 * bagian "Import data awal" untuk cara menghasilkan potongan JSON per-batch).
 */
function importSeedFromJson(jsonText) {
  const records = JSON.parse(jsonText);
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const now = new Date().toISOString();
  const lkpRows = [];
  const kelasRows = [];
  records.forEach((r) => {
    lkpRows.push([r.id, r.npsn, r.nama_lkp, r.alamat, r.provinsi, r.kab_kota, r.program_keterampilan, r.status_bimtek, (r.tahun_bimtek || []).join(","), r.catatan || "", now, now]);
    (r.kelas || []).forEach((k) => {
      kelasRows.push([k.id, r.id, k.nama_kelas, k.link, k.peserta, k.lulusan, k.status]);
    });
  });
  if (lkpRows.length) lkpSheet.getRange(lkpSheet.getLastRow() + 1, 1, lkpRows.length, lkpRows[0].length).setValues(lkpRows);
  if (kelasRows.length) kelasSheet.getRange(kelasSheet.getLastRow() + 1, 1, kelasRows.length, kelasRows[0].length).setValues(kelasRows);
}

/* ---------------------------------------------------------------------- */
function sheetToObjects(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i]));
    return obj;
  });
}

function findRowIndexById(sh, id, idCol) {
  idCol = idCol || "id";
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const col = headers.indexOf(idCol);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col]) === String(id)) return i + 1; // 1-based row number
  }
  return -1;
}

function uid(prefix) {
  return prefix + "-" + Utilities.getUuid().slice(0, 8);
}

function logAction(username, action, detail) {
  const sh = getOrCreateSheet(SHEET_LOG, ["timestamp", "username", "action", "detail"]);
  sh.appendRow([new Date().toISOString(), username || "-", action, JSON.stringify(detail || {})]);
}

/* ---------------------------------------------------------------------- */
/* Auth sederhana berbasis token di CacheService (berlaku 6 jam)          */
/* ---------------------------------------------------------------------- */
function login(username, password) {
  const props = PropertiesService.getScriptProperties();
  const validUser = props.getProperty("ADMIN_USERNAME") || "admin";
  const validPass = props.getProperty("ADMIN_PASSWORD") || "admin123";
  if (username !== validUser || password !== validPass) {
    throw new Error("Username atau password salah");
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("token_" + token, username, 6 * 60 * 60);
  logAction(username, "login", {});
  return { token, username };
}

function requireAuth(token) {
  if (!token) throw new Error("Tidak terautentikasi. Silakan login kembali.");
  const username = CacheService.getScriptCache().get("token_" + token);
  if (!username) throw new Error("Sesi telah berakhir. Silakan login kembali.");
  return username;
}

/* ---------------------------------------------------------------------- */
/* Perakit objek LKP lengkap dengan kelas anak                            */
/* ---------------------------------------------------------------------- */
function buildLkpObjects() {
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const lkpRows = sheetToObjects(lkpSheet);
  const kelasRows = sheetToObjects(kelasSheet);

  const kelasByLkp = {};
  kelasRows.forEach((k) => {
    if (!kelasByLkp[k.lkp_id]) kelasByLkp[k.lkp_id] = [];
    kelasByLkp[k.lkp_id].push({
      id: k.id,
      nama_kelas: k.nama_kelas,
      link: k.link,
      peserta: Number(k.peserta) || 0,
      lulusan: Number(k.lulusan) || 0,
      status: k.status,
      program_keterampilan: k.program_keterampilan || "",
    });
  });

  return lkpRows.map((r) => {
    const kelas = kelasByLkp[r.id] || [];
    return {
      id: r.id,
      npsn: r.npsn,
      nama_lkp: r.nama_lkp,
      alamat: r.alamat,
      provinsi: r.provinsi,
      kab_kota: r.kab_kota,
      program_keterampilan: r.program_keterampilan,
      status_bimtek: r.status_bimtek,
      status_moodle: r.status_moodle || "Belum",
      tahun_bimtek: String(r.tahun_bimtek || "").split(",").filter(Boolean).map(Number),
      catatan: r.catatan,
      kelas: kelas,
      jumlah_kelas: kelas.length,
      jumlah_peserta: kelas.reduce((s, k) => s + k.peserta, 0),
      jumlah_lulusan: kelas.reduce((s, k) => s + k.lulusan, 0),
    };
  });
}

/* ==========================================================================
   doGet — endpoint baca (listLkp, getLkp, getReferensi)
   ========================================================================== */
function doGet(e) {
  try {
    const action = e.parameter.action;
    let data;
    if (action === "listLkp") {
      data = buildLkpObjects();
    } else if (action === "getLkp") {
      data = buildLkpObjects().find((d) => d.id === e.parameter.id) || null;
    } else if (action === "getReferensi") {
      data = getReferensiData();
    } else {
      throw new Error("Aksi tidak dikenal: " + action);
    }
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, message: err.message });
  }
}

/** Daftar referensi untuk dropdown filter (Provinsi, Program Keterampilan).
 *  Prioritas: pakai daftar baku dari sheet "Referensi" (tipe=provinsi / tipe=program)
 *  kalau sudah diisi admin — supaya konsisten dengan pilihan dropdown resmi
 *  (mis. custom field "Bidang Keterampilan" di Moodle). Kalau sheet Referensi
 *  untuk tipe tsb masih kosong, otomatis diturunkan dari data yang ada (fallback,
 *  bisa jadi masih ada variasi penulisan sampai admin mengisi daftar bakunya). */
function getReferensiData() {
  const refSheet = getOrCreateSheet(SHEET_REF, ["tipe", "nilai"]);
  const refRows = sheetToObjects(refSheet);
  const fromRef = (tipe) => [...new Set(refRows.filter((r) => String(r.tipe).trim().toLowerCase() === tipe).map((r) => String(r.nilai).trim()))].filter(Boolean).sort();

  const provinsiRef = fromRef("provinsi");
  const programRef = fromRef("program");

  let provinsi = provinsiRef;
  let program = programRef;

  if (provinsi.length === 0 || program.length === 0) {
    const all = buildLkpObjects();
    if (provinsi.length === 0) provinsi = [...new Set(all.map((d) => d.provinsi))].filter(Boolean).sort();
    if (program.length === 0) program = [...new Set(all.map((d) => d.program_keterampilan))].filter(Boolean).sort();
  }

  return { provinsi, program };
}

/* ==========================================================================
   doPost — endpoint tulis (login, create/update/delete LKP & Kelas, import)
   ========================================================================== */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || {};
    let data;

    if (action === "login") {
      data = login(payload.username, payload.password);
      return jsonResponse({ ok: true, data });
    }

    // Semua aksi selain login memerlukan token valid
    const username = requireAuth(body.token);

    if (action === "createLkp") {
      data = createLkp(payload, username);
    } else if (action === "updateLkp") {
      data = updateLkp(payload, username);
    } else if (action === "deleteLkp") {
      data = deleteLkp(payload, username);
    } else if (action === "createKelas") {
      data = createKelas(payload, username);
    } else if (action === "updateKelas") {
      data = updateKelas(payload, username);
    } else if (action === "deleteKelas") {
      data = deleteKelas(payload, username);
    } else if (action === "importBulk") {
      data = importBulk(payload, username);
    } else if (action === "importMoodleCsv") {
      data = importMoodleCsv(payload, username);
    } else if (action === "importCertificateReport") {
      data = importCertificateReport(payload, username);
    } else {
      throw new Error("Aksi tidak dikenal: " + action);
    }
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, message: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
   CRUD LKP
   ========================================================================== */
function createLkp(payload, username) {
  const sh = getOrCreateSheet(SHEET_LKP, []);
  const id = uid("LKP");
  const now = new Date().toISOString();
  sh.appendRow([id, payload.npsn || "", payload.nama_lkp || "", payload.alamat || "", payload.provinsi || "", payload.kab_kota || "", payload.program_keterampilan || "", payload.status_bimtek || "Belum Bimtek", (payload.tahun_bimtek || []).join(","), payload.catatan || "", now, now]);

  if (Array.isArray(payload.kelas) && payload.kelas.length) {
    const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
    payload.kelas.forEach((k) => {
      kelasSheet.appendRow([uid("K"), id, k.nama_kelas, k.link || "", k.peserta || 0, k.lulusan || 0, k.status || "Materi Belum Lengkap", k.program_keterampilan || ""]);
    });
  }
  logAction(username, "createLkp", { id, nama_lkp: payload.nama_lkp });
  return buildLkpObjects().find((d) => d.id === id);
}

function updateLkp(payload, username) {
  const sh = getOrCreateSheet(SHEET_LKP, []);
  const row = findRowIndexById(sh, payload.id);
  if (row === -1) throw new Error("Data LKP tidak ditemukan");
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const setCell = (col, val) => sh.getRange(row, headers.indexOf(col) + 1).setValue(val);

  if (payload.npsn !== undefined) setCell("npsn", payload.npsn);
  if (payload.nama_lkp !== undefined) setCell("nama_lkp", payload.nama_lkp);
  if (payload.alamat !== undefined) setCell("alamat", payload.alamat);
  if (payload.provinsi !== undefined) setCell("provinsi", payload.provinsi);
  if (payload.kab_kota !== undefined) setCell("kab_kota", payload.kab_kota);
  if (payload.program_keterampilan !== undefined) setCell("program_keterampilan", payload.program_keterampilan);
  if (payload.status_bimtek !== undefined) setCell("status_bimtek", payload.status_bimtek);
  if (payload.tahun_bimtek !== undefined) setCell("tahun_bimtek", (payload.tahun_bimtek || []).join(","));
  if (payload.catatan !== undefined) setCell("catatan", payload.catatan);
  setCell("updated_at", new Date().toISOString());

  // Ganti seluruh daftar kelas jika dikirim (pendekatan replace-all, sederhana & konsisten)
  if (Array.isArray(payload.kelas)) {
    const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
    const values = kelasSheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][1]) === String(payload.id)) kelasSheet.deleteRow(i + 1);
    }
    payload.kelas.forEach((k) => {
      kelasSheet.appendRow([k.id && String(k.id).length ? k.id : uid("K"), payload.id, k.nama_kelas, k.link || "", k.peserta || 0, k.lulusan || 0, k.status || "Materi Belum Lengkap", k.program_keterampilan || ""]);
    });
  }

  logAction(username, "updateLkp", { id: payload.id });
  return buildLkpObjects().find((d) => d.id === payload.id);
}

function deleteLkp(payload, username) {
  const sh = getOrCreateSheet(SHEET_LKP, []);
  const row = findRowIndexById(sh, payload.id);
  if (row === -1) throw new Error("Data LKP tidak ditemukan");
  sh.deleteRow(row);

  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const values = kelasSheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][1]) === String(payload.id)) kelasSheet.deleteRow(i + 1);
  }
  logAction(username, "deleteLkp", { id: payload.id });
  return { deleted: true };
}

/* ==========================================================================
   CRUD Kelas (per baris, dipakai bila tidak melalui replace-all updateLkp)
   ========================================================================== */
function createKelas(payload, username) {
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const id = uid("K");
  kelasSheet.appendRow([id, payload.lkpId, payload.nama_kelas, payload.link || "", payload.peserta || 0, payload.lulusan || 0, payload.status || "Materi Belum Lengkap", payload.program_keterampilan || ""]);
  logAction(username, "createKelas", { lkpId: payload.lkpId, id });
  return buildLkpObjects().find((d) => d.id === payload.lkpId);
}

function updateKelas(payload, username) {
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const row = findRowIndexById(kelasSheet, payload.kelasId);
  if (row === -1) throw new Error("Kelas tidak ditemukan");
  const headers = kelasSheet.getRange(1, 1, 1, kelasSheet.getLastColumn()).getValues()[0];
  const setCell = (col, val) => kelasSheet.getRange(row, headers.indexOf(col) + 1).setValue(val);
  if (payload.nama_kelas !== undefined) setCell("nama_kelas", payload.nama_kelas);
  if (payload.link !== undefined) setCell("link", payload.link);
  if (payload.peserta !== undefined) setCell("peserta", payload.peserta);
  if (payload.lulusan !== undefined) setCell("lulusan", payload.lulusan);
  if (payload.status !== undefined) setCell("status", payload.status);
  if (payload.program_keterampilan !== undefined && headers.indexOf("program_keterampilan") !== -1) setCell("program_keterampilan", payload.program_keterampilan);
  logAction(username, "updateKelas", { kelasId: payload.kelasId });
  return buildLkpObjects().find((d) => d.id === payload.lkpId);
}

function deleteKelas(payload, username) {
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const row = findRowIndexById(kelasSheet, payload.kelasId);
  if (row === -1) throw new Error("Kelas tidak ditemukan");
  kelasSheet.deleteRow(row);
  logAction(username, "deleteKelas", { kelasId: payload.kelasId });
  return buildLkpObjects().find((d) => d.id === payload.lkpId);
}

/* ==========================================================================
   Import massal (dipakai fitur Import Excel di Admin Panel)
   ========================================================================== */
function importBulk(payload, username) {
  const sh = getOrCreateSheet(SHEET_LKP, []);
  const now = new Date().toISOString();
  const rows = (payload.records || []).map((r) => [uid("LKP"), r.npsn || "", r.nama_lkp || "", r.alamat || "", r.provinsi || "", r.kab_kota || "", r.program_keterampilan || "", "Belum Bimtek", "", "", now, now]);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  logAction(username, "importBulk", { count: rows.length });
  return { imported: rows.length };
}

/* ==========================================================================
   Import laporan peserta Moodle via CSV — dipakai fitur Admin Panel sebagai
   alternatif saat sinkronisasi API lambat/belum sampai giliran kategorinya.
   Format record dari frontend (sudah diagregasi per kelas di sisi klien):
   { npsn, courseId, namaKelas, link, peserta }
   Memakai skema id yang SAMA dengan syncFromMoodle ("K-MOODLE-{courseId}"),
   jadi aman dijalankan kapan saja tanpa bikin data dobel. TIDAK membuat LKP
   baru untuk NPSN yang tidak dikenal (supaya tidak membuat entri asal-asalan
   dari kategori uji coba/dummy di laporan) — yang tidak cocok dicatat di
   ringkasan supaya bisa ditinjau manual.
   ========================================================================== */
function importMoodleCsv(payload, username) {
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const existingLkp = sheetToObjects(lkpSheet);
  const npsnToId = {};
  existingLkp.forEach((r) => {
    const npsn = String(r.npsn || "").trim();
    if (npsn) npsnToId[npsn] = r.id;
  });

  const records = payload.records || [];
  let berhasil = 0;
  const npsnTidakCocok = new Set();

  records.forEach((rec) => {
    const npsn = String(rec.npsn || "").trim();
    const lkpId = npsnToId[npsn];
    if (!lkpId) {
      if (npsn) npsnTidakCocok.add(npsn);
      return;
    }
    const course = { id: rec.courseId, fullname: rec.namaKelas };
    const bidang = rec.bidang || "";
    upsertKelasFromMoodle(kelasSheet, lkpId, course, Number(rec.peserta) || 0, Number(rec.lulusan) || 0, null, bidang);
    berhasil++;
  });

  const ringkasan = { total_baris: records.length, berhasil, npsn_tidak_cocok: npsnTidakCocok.size, contoh_npsn_tidak_cocok: [...npsnTidakCocok].slice(0, 15) };
  logAction(username, "importMoodleCsv", ringkasan);
  return ringkasan;
}

/* ==========================================================================
   Import laporan Certificate Issued (dari Configurable Reports + SQL Moodle,
   JOIN ke tabel customcert_issues) — sumber lulusan yang SUNGGUHAN, bukan
   proksi completion lagi. Format record dari frontend:
   { npsn, courseId, namaKelas, pesertaLaporan, lulusan }

   PENTING — beda dari importMoodleCsv: fungsi ini HANYA menimpa kolom
   "lulusan" pada kelas yang SUDAH ADA (id "K-MOODLE-{courseId}"), supaya
   tidak menimpa "peserta" yang sudah tersinkron dari laporan Participants
   (sumber peserta yang lebih dipercaya / konsisten dengan sync API).
   Kalau kelasnya belum pernah ada sama sekali di sheet Kelas, baru dibuat
   baris baru memakai peserta dari laporan ini (karena tidak ada sumber lain).
   ========================================================================== */
function importCertificateReport(payload, username) {
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const existingLkp = sheetToObjects(lkpSheet);
  const npsnToId = {};
  existingLkp.forEach((r) => {
    const npsn = String(r.npsn || "").trim();
    if (npsn) npsnToId[npsn] = r.id;
  });

  const headers = kelasSheet.getRange(1, 1, 1, kelasSheet.getLastColumn()).getValues()[0];
  const lulusanCol = headers.indexOf("lulusan") + 1;

  const records = payload.records || [];
  let diperbarui = 0;
  let dibuatBaru = 0;
  const npsnTidakCocok = new Set();

  records.forEach((rec) => {
    const npsn = String(rec.npsn || "").trim();
    const lkpId = npsnToId[npsn];
    if (!lkpId) {
      if (npsn) npsnTidakCocok.add(npsn);
      return;
    }
    const kelasId = "K-MOODLE-" + rec.courseId;
    const row = findRowIndexById(kelasSheet, kelasId);
    if (row !== -1) {
      // Kelas sudah ada — timpa HANYA kolom lulusan, biarkan peserta/status/link apa adanya
      kelasSheet.getRange(row, lulusanCol).setValue(Number(rec.lulusan) || 0);
      diperbarui++;
    } else {
      // Belum pernah tersinkron sama sekali — buat baru pakai data seadanya dari laporan ini
      const course = { id: rec.courseId, fullname: rec.namaKelas };
      upsertKelasFromMoodle(kelasSheet, lkpId, course, Number(rec.pesertaLaporan) || 0, Number(rec.lulusan) || 0, null, "");
      dibuatBaru++;
    }
  });

  const ringkasan = { total_baris: records.length, diperbarui, dibuat_baru: dibuatBaru, npsn_tidak_cocok: npsnTidakCocok.size, contoh_npsn_tidak_cocok: [...npsnTidakCocok].slice(0, 15) };
  logAction(username, "importCertificateReport", ringkasan);
  return ringkasan;
}

/* ============================================================================
   INTEGRASI MOODLE — Sinkronisasi Kategori/Kelas/Peserta
   ============================================================================
   Pemetaan: 1 Kategori Moodle = 1 LKP. Setiap kelas (course) di dalam
   kategori itu menjadi 1 baris di sheet "Kelas", dengan jumlah peserta
   dihitung dari enrolment (role "student").

   CATATAN: Penghitungan "lulusan/sertifikat" SEMENTARA DINONAKTIFKAN atas
   permintaan — nilainya selalu 0 untuk saat ini, supaya sinkronisasi lebih
   cepat & sederhana (tidak perlu memanggil status completion per peserta).
   Struktur kode tetap disiapkan agar mudah diaktifkan kembali nanti bila
   dibutuhkan — cukup minta bantuan untuk mengaktifkan kembali logika
   completion Custom Certificate.

   SETUP DI MOODLE (dilakukan oleh admin Moodle, sekali saja):
   1. Site administration > Advanced features > aktifkan "Enable web services".
   2. Site administration > Plugins > Web services > Manage protocols >
      aktifkan "REST protocol".
   3. Site administration > Plugins > Web services > External services >
      buat service baru "Dashboard Kursus Daring API", centang "Enabled",
      tambahkan fungsi berikut ke dalamnya:
        - core_course_get_categories
        - core_course_get_courses_by_field
        - core_enrol_get_enrolled_users
   4. Buat/gunakan user khusus (mis. "apisync") dengan role yang punya izin
      melihat semua kategori/kursus/peserta (mis. Manager, atau role custom
      dengan capability moodle/course:viewparticipants).
   5. Site administration > Plugins > Web services > Manage tokens >
      buat token baru untuk user tsb dan service pada langkah 3. Salin token-nya.

   SETUP DI APPS SCRIPT (sekali saja):
   1. Buka Project Settings > Script Properties, tambahkan:
        MOODLE_URL   = https://domain-moodle-anda.sch.id   (tanpa slash di akhir)
        MOODLE_TOKEN = (token dari langkah 5 di atas)
   2. Jalankan fungsi createMoodleSyncTrigger() SEKALI dari editor Apps
      Script agar sinkronisasi berjalan otomatis setiap hari jam 02:00.
      (Atau jalankan syncFromMoodle() manual kapan saja untuk sinkron langsung.)
   ============================================================================ */

const MOODLE_CERT_MODNAME = "customcert"; // dipakai kembali bila penghitungan sertifikat diaktifkan

/** HAPUS DATA EXCEL LAMA untuk LKP yang status_moodle = "Ya" SAJA.
 *  Sebelum menghapus, seluruh baris yang akan dihapus DICADANGKAN dulu ke
 *  sheet baru "Backup_Kelas_Terhapus" (ditambahkan/append, tidak ditimpa),
 *  supaya bisa dikembalikan manual kalau ternyata ada yang salah hapus.
 *  LKP yang belum status_moodle="Ya" TIDAK disentuh sama sekali. */
function hapusKelasExcelUntukLkpDiMoodle() {
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const lkpRows = sheetToObjects(lkpSheet);
  const lkpSudahMoodle = new Set(lkpRows.filter((r) => String(r.status_moodle).trim() === "Ya").map((r) => r.id));

  const isLama = (id) => /^K-\d+-\d+$/.test(String(id));

  const ss = getSS();
  let backupSheet = ss.getSheetByName("Backup_Kelas_Terhapus");
  if (!backupSheet) {
    backupSheet = ss.insertSheet("Backup_Kelas_Terhapus");
    backupSheet.appendRow(["dihapus_pada", "id", "lkp_id", "nama_kelas", "link", "peserta", "lulusan", "status", "program_keterampilan"]);
    backupSheet.setFrozenRows(1);
  }

  const values = kelasSheet.getDataRange().getValues();
  const headers = values[0];
  const now = new Date().toISOString();
  let dihapus = 0;

  // Hapus dari bawah ke atas supaya nomor baris tidak bergeser saat proses
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    const rowObj = {};
    headers.forEach((h, idx) => (rowObj[h] = row[idx]));
    if (isLama(rowObj.id) && lkpSudahMoodle.has(rowObj.lkp_id)) {
      backupSheet.appendRow([now, rowObj.id, rowObj.lkp_id, rowObj.nama_kelas, rowObj.link, rowObj.peserta, rowObj.lulusan, rowObj.status, rowObj.program_keterampilan || ""]);
      kelasSheet.deleteRow(i + 1);
      dihapus++;
    }
  }

  logAction("admin", "hapusKelasExcelUntukLkpDiMoodle", { dihapus });
  Logger.log(`Selesai. ${dihapus} baris kelas lama (Excel) dihapus untuk LKP yang sudah ada di Moodle. Cadangan tersimpan di sheet "Backup_Kelas_Terhapus".`);
  return { dihapus };
}

/** BACKFILL — jalankan SEKALI SAJA setelah menambah kolom "status_moodle" ke
 *  sheet LKP, supaya LKP yang sudah tersinkron dari run-run syncFromMoodle
 *  SEBELUM kolom ini ada, ikut ditandai "Ya" tanpa perlu sync ulang dari nol.
 *  Aman dijalankan berkali-kali (idempotent). */
function backfillStatusMoodle() {
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const headers = lkpSheet.getRange(1, 1, 1, lkpSheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf("status_moodle");
  if (col === -1) throw new Error('Kolom "status_moodle" belum ada di sheet LKP. Tambahkan dulu header itu di baris 1 sheet LKP, baru jalankan fungsi ini lagi.');

  const kelasRows = sheetToObjects(kelasSheet);
  const lkpIdsWithMoodle = new Set(kelasRows.filter((k) => /^K-MOODLE-/.test(String(k.id))).map((k) => k.lkp_id));

  const lkpValues = lkpSheet.getDataRange().getValues();
  const idCol = headers.indexOf("id");
  let ditandai = 0;
  for (let i = 1; i < lkpValues.length; i++) {
    if (lkpIdsWithMoodle.has(lkpValues[i][idCol])) {
      lkpSheet.getRange(i + 1, col + 1).setValue("Ya");
      ditandai++;
    }
  }
  Logger.log(`Selesai. ${ditandai} LKP ditandai status_moodle = "Ya" berdasarkan kelas yang sudah ada.`);
  return { ditandai };
}

/** REVIEW DATA GANDA — jalankan manual sekali (atau kapan saja) untuk melihat
 *  LKP mana yang punya kelas lama dari Excel (id format "K-angka-angka")
 *  SEKALIGUS kelas baru dari Moodle (id format "K-MOODLE-angka"), supaya bisa
 *  ditinjau dan diputuskan mana yang perlu dihapus manual. TIDAK menghapus
 *  apapun secara otomatis — cuma menulis laporan ke sheet baru
 *  "Review_Kelas_Ganda" supaya aman ditinjau dulu. */
function reviewKelasGanda() {
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasRows = sheetToObjects(kelasSheet);
  const lkpRows = sheetToObjects(lkpSheet);
  const namaLkpById = {};
  lkpRows.forEach((r) => (namaLkpById[r.id] = r.nama_lkp));

  const isLama = (id) => /^K-\d+-\d+$/.test(String(id));
  const isBaru = (id) => /^K-MOODLE-/.test(String(id));

  const byLkp = {};
  kelasRows.forEach((k) => {
    if (!byLkp[k.lkp_id]) byLkp[k.lkp_id] = { lama: [], baru: [] };
    if (isLama(k.id)) byLkp[k.lkp_id].lama.push(k);
    else if (isBaru(k.id)) byLkp[k.lkp_id].baru.push(k);
  });

  const ss = getSS();
  let reviewSheet = ss.getSheetByName("Review_Kelas_Ganda");
  if (reviewSheet) ss.deleteSheet(reviewSheet); // mulai bersih tiap kali dijalankan ulang
  reviewSheet = ss.insertSheet("Review_Kelas_Ganda");
  reviewSheet.appendRow(["lkp_id", "nama_lkp", "jenis", "kelas_id", "nama_kelas", "peserta", "saran"]);
  reviewSheet.setFrozenRows(1);

  let lkpTerdampak = 0;
  Object.keys(byLkp).forEach((lkpId) => {
    const g = byLkp[lkpId];
    if (g.lama.length === 0 || g.baru.length === 0) return; // hanya yang punya KEDUANYA
    lkpTerdampak++;
    const namaLkp = namaLkpById[lkpId] || "(tidak diketahui)";
    g.lama.forEach((k) => {
      const saran = Number(k.peserta) === 0 ? "Kandidat kuat untuk dihapus (data lama, 0 peserta)" : "Cek manual — data lama tapi ada peserta, mungkin bukan duplikat";
      reviewSheet.appendRow([lkpId, namaLkp, "LAMA (Excel)", k.id, k.nama_kelas, k.peserta, saran]);
    });
    g.baru.forEach((k) => {
      reviewSheet.appendRow([lkpId, namaLkp, "BARU (Moodle)", k.id, k.nama_kelas, k.peserta, "Data hidup dari Moodle — pertahankan"]);
    });
  });

  reviewSheet.autoResizeColumns(1, 7);
  Logger.log(`Selesai. ${lkpTerdampak} LKP punya kelas lama & baru sekaligus — lihat sheet "Review_Kelas_Ganda".`);
  return { lkp_terdampak: lkpTerdampak };
}

/** FUNGSI DIAGNOSTIK — cek role apa saja yang sebenarnya dikembalikan Moodle
 *  untuk peserta di 1 course tertentu. Ganti angka di dalam kurung dengan
 *  ID course yang Anda tahu punya peserta (lihat dari URL course, contoh
 *  https://.../course/view.php?id=1089 → courseId = 1089). */
function debugCekPesertaMoodle(courseId) {
  const enrolled = moodleCall("core_enrol_get_enrolled_users", { courseid: courseId }) || [];
  Logger.log(`Total user terdaftar di course ${courseId}: ${enrolled.length}`);
  enrolled.slice(0, 10).forEach((u) => {
    const roleNames = (u.roles || []).map((r) => `${r.shortname} (${r.name || "-"})`).join(", ");
    Logger.log(`user="${u.fullname}" | roles=[${roleNames || "TIDAK ADA ROLE"}]`);
  });
}

/** FUNGSI DIAGNOSTIK — jalankan manual sekali untuk mengecek apa yang benar-benar
 *  dikembalikan Moodle untuk kategori yang punya course di dalamnya, khususnya
 *  field idnumber. Hasilnya lihat di Execution log (bukan disimpan ke sheet).
 *  Aman dijalankan berkali-kali, tidak mengubah data apapun. */
function debugCekKategoriMoodle() {
  const categories = moodleCall("core_course_get_categories", {});
  const withCourses = categories.filter((c) => c.coursecount && c.coursecount > 0);
  Logger.log(`Total kategori: ${categories.length}, punya course: ${withCourses.length}`);
  withCourses.slice(0, 20).forEach((c) => {
    Logger.log(`id=${c.id} | name="${c.name}" | idnumber="${c.idnumber}" | coursecount=${c.coursecount}`);
  });
  if (withCourses.length > 20) Logger.log(`... dan ${withCourses.length - 20} kategori lainnya (dipotong demi keringkasan log)`);
}

/** Panggilan generik ke Moodle Web Service REST (format JSON) */
function moodleCall(wsfunction, params) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty("MOODLE_URL");
  const token = props.getProperty("MOODLE_TOKEN");
  if (!baseUrl || !token) throw new Error("MOODLE_URL / MOODLE_TOKEN belum diatur di Script Properties.");

  const query = Object.assign({ wstoken: token, wsfunction: wsfunction, moodlewsrestformat: "json" }, params || {});
  const qs = Object.keys(query)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(query[k]))
    .join("&");
  const url = `${baseUrl}/webservice/rest/server.php?${qs}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  if (json && json.exception) {
    throw new Error(`Moodle API error [${wsfunction}]: ${json.message || json.errorcode}`);
  }
  return json;
}

/** Fungsi utama sinkronisasi — jalankan manual atau lewat trigger otomatis.
 *  Karena jumlah kategori bisa lebih banyak dari yang muat diproses dalam
 *  1 kali jalan (batas 6 menit Apps Script), fungsi ini memakai "checkpoint"
 *  (disimpan di Script Properties) supaya run berikutnya MELANJUTKAN dari
 *  kategori terakhir yang berhasil diproses, bukan mengulang dari awal lagi.
 *  Setelah 1 putaran penuh selesai (sampai kategori terakhir), checkpoint
 *  otomatis direset supaya putaran berikutnya me-refresh dari awal lagi. */
function syncFromMoodle() {
  const t0 = new Date().getTime();
  const props = PropertiesService.getScriptProperties();
  const lkpSheet = getOrCreateSheet(SHEET_LKP, []);
  const kelasSheet = getOrCreateSheet(SHEET_KELAS, []);
  const existingLkp = sheetToObjects(lkpSheet);

  // Catatan: sengaja TIDAK memakai filter criteria "visible" — Moodle mewajibkan
  // capability tambahan (moodle/category:viewhiddencategories) untuk filter itu,
  // yang sering tidak dimiliki user API biasa. Tanpa filter, Moodle otomatis
  // mengembalikan kategori yang boleh dilihat oleh user token ini.
  const allCategories = moodleCall("core_course_get_categories", {});
  // Urutan tetap (berdasarkan id) supaya checkpoint konsisten antar run
  allCategories.sort((a, b) => a.id - b.id);

  const cursor = Number(props.getProperty("MOODLE_SYNC_CURSOR") || 0);
  let startIndex = 0;
  if (cursor) {
    const idx = allCategories.findIndex((c) => c.id === cursor);
    startIndex = idx === -1 ? 0 : idx + 1; // lanjut SETELAH kategori checkpoint
  }

  let totalKelas = 0;
  let totalPeserta = 0;
  let totalLulusan = 0;
  let skippedForTimeout = 0;
  let skippedNoIdNumber = 0;
  let processedCount = 0;
  let reachedEnd = true;
  let lastProcessedId = cursor;

  for (let i = startIndex; i < allCategories.length; i++) {
    const cat = allCategories[i];

    if (new Date().getTime() - t0 > 5 * 60 * 1000) {
      reachedEnd = false; // belum sampai kategori terakhir — masih ada sisa untuk run berikutnya
      skippedForTimeout = allCategories.length - i;
      break;
    }

    lastProcessedId = cat.id;
    processedCount++;

    if (!cat.coursecount || cat.coursecount === 0) continue;

    const lkpId = findOrCreateLkpByNpsn(lkpSheet, existingLkp, cat.idnumber, cat.name);
    if (!lkpId) {
      skippedNoIdNumber++;
      continue; // kategori belum diisi "ID number" (NPSN) — dilewati, tidak disinkron
    }
    const courseResp = moodleCall("core_course_get_courses_by_field", { field: "category", value: cat.id });
    const courses = (courseResp.courses || []).filter((c) => c.id !== 1); // exclude "Site" course

    courses.forEach((course) => {
      const enrolled = moodleCall("core_enrol_get_enrolled_users", { courseid: course.id }) || [];
      // Role peserta di instalasi Moodle ini bernama "peserta" (custom), bukan "student"
      // bawaan Moodle — daftar ini mendukung keduanya sekaligus supaya tetap aman
      // dipakai walau nanti role-nya berubah lagi atau dipakai di Moodle lain.
      const ROLE_PESERTA = ["student", "peserta"];
      const students = enrolled.filter((u) => (u.roles || []).some((r) => ROLE_PESERTA.includes(r.shortname)));
      const bidang = getCourseCustomFieldValue(course, "bidang_keterampilan");

      // Sertifikat/lulusan SEMENTARA DIABAIKAN atas permintaan — jumlah lulusan diisi 0.
      // Untuk mengaktifkan kembali penghitungan lulusan dari completion Custom Certificate,
      // lihat versi lengkap fungsi ini di riwayat/dokumentasi, atau minta bantuan kembali.
      const lulus = 0;

      upsertKelasFromMoodle(kelasSheet, lkpId, course, students.length, lulus, null, bidang);
      totalKelas++;
      totalPeserta += students.length;
      totalLulusan += lulus;
    });
  }

  // Simpan/reset checkpoint: kalau sudah sampai kategori terakhir dalam 1 putaran,
  // reset ke awal (0) supaya putaran berikutnya me-refresh ulang dari kategori pertama.
  // Kalau berhenti karena timeout, simpan id kategori terakhir yang diproses supaya
  // run berikutnya lanjut dari situ.
  props.setProperty("MOODLE_SYNC_CURSOR", reachedEnd ? "0" : String(lastProcessedId));

  const ringkasan = {
    total_kategori: allCategories.length,
    kategori_diproses_run_ini: processedCount,
    kelas: totalKelas,
    peserta: totalPeserta,
    lulusan: totalLulusan,
    kategori_tanpa_id_number: skippedNoIdNumber,
    kategori_belum_diproses: skippedForTimeout,
    putaran_selesai: reachedEnd,
  };
  logAction("moodle-sync", "syncFromMoodle", ringkasan);
  return ringkasan;
}

/** Ambil nilai Custom Course Field Moodle berdasarkan "Short name"-nya.
 *  Moodle sudah menyertakan array `customfields` pada respons
 *  core_course_get_courses_by_field, jadi tidak perlu panggilan API tambahan. */
function getCourseCustomFieldValue(course, shortname) {
  const field = (course.customfields || []).find((f) => f.shortname === shortname);
  if (!field) return "";
  // "value" biasanya sudah berupa teks tampilan (mis. label dropdown yang dipilih)
  return String(field.value || field.valueraw || "").trim();
}

/** Cari cmid aktivitas Custom Certificate dalam 1 course; null bila tidak ada */
function findCertificateCmId(courseId) {
  const contents = moodleCall("core_course_get_contents", { courseid: courseId });
  for (const section of contents) {
    for (const mod of section.modules || []) {
      if (mod.modname === MOODLE_CERT_MODNAME) return mod.id;
    }
  }
  return null;
}

/** Cocokkan kategori Moodle ke LKP yang sudah ada lewat NPSN — dibaca dari
 *  field "ID number" pada kategori Moodle (properti `idnumber`), BUKAN dari
 *  ID kategori internal Moodle maupun nama kategori (supaya tidak salah
 *  cocok akibat penulisan nama yang berbeda-beda).
 *  Jika kategori tidak punya "ID number" terisi, kategori itu DILEWATI
 *  (tidak disinkron) — dicatat di Log supaya kelihatan mana yang perlu
 *  dilengkapi ID number-nya di Moodle. */
function findOrCreateLkpByNpsn(lkpSheet, existingLkp, categoryIdNumber, categoryName) {
  const npsn = String(categoryIdNumber || "").trim();
  if (!npsn) return null; // kategori belum diisi NPSN di "ID number" — lewati

  const headers = lkpSheet.getRange(1, 1, 1, lkpSheet.getLastColumn()).getValues()[0];
  const hasStatusMoodleCol = headers.indexOf("status_moodle") !== -1;

  const found = existingLkp.find((r) => String(r.npsn || "").trim() === npsn);
  if (found) {
    if (hasStatusMoodleCol) {
      const row = findRowIndexById(lkpSheet, found.id);
      if (row !== -1) lkpSheet.getRange(row, headers.indexOf("status_moodle") + 1).setValue("Ya");
    }
    return found.id;
  }

  const id = uid("LKP");
  const now = new Date().toISOString();
  const rowObj = {
    id,
    npsn,
    nama_lkp: categoryName,
    alamat: "",
    provinsi: "",
    kab_kota: "",
    program_keterampilan: "",
    status_bimtek: "Belum Bimtek",
    tahun_bimtek: "",
    catatan: "Dibuat otomatis dari sinkronisasi Moodle (dicocokkan lewat NPSN pada ID number kategori) — lengkapi alamat, provinsi & kab/kota secara manual.",
    created_at: now,
    updated_at: now,
    status_moodle: "Ya",
  };
  lkpSheet.appendRow(headers.map((h) => (rowObj[h] !== undefined ? rowObj[h] : "")));
  existingLkp.push({ id, npsn, nama_lkp: categoryName });
  return id;
}

/** Tambah/perbarui 1 baris kelas hasil sinkronisasi Moodle (idempotent berdasar courseid) */
function upsertKelasFromMoodle(kelasSheet, lkpId, course, jumlahPeserta, jumlahLulusan, cmId, bidangKeterampilan) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty("MOODLE_URL");
  const kelasId = "K-MOODLE-" + course.id;
  const link = `${baseUrl}/course/view.php?id=${course.id}`;
  let status = "Materi Belum Lengkap";
  if (jumlahPeserta > 0) status = "Sudah Berjalan";
  else if (cmId) status = "Materi Lengkap - Belum Ada Peserta";

  const headers = kelasSheet.getRange(1, 1, 1, kelasSheet.getLastColumn()).getValues()[0];
  const hasBidangCol = headers.indexOf("program_keterampilan") !== -1;

  const row = findRowIndexById(kelasSheet, kelasId);
  if (row === -1) {
    // Susun baris sesuai urutan header sheet supaya tetap benar walau header sudah
    // ditambah kolom "program_keterampilan" (sheet baru) atau belum (sheet lama).
    const rowObj = { id: kelasId, lkp_id: lkpId, nama_kelas: course.fullname, link: link, peserta: jumlahPeserta, lulusan: jumlahLulusan, status: status, program_keterampilan: bidangKeterampilan || "" };
    kelasSheet.appendRow(headers.map((h) => (rowObj[h] !== undefined ? rowObj[h] : "")));
  } else {
    const setCell = (col, val) => kelasSheet.getRange(row, headers.indexOf(col) + 1).setValue(val);
    setCell("lkp_id", lkpId);
    setCell("nama_kelas", course.fullname);
    setCell("link", link);
    setCell("peserta", jumlahPeserta);
    setCell("lulusan", jumlahLulusan);
    setCell("status", status);
    if (hasBidangCol && bidangKeterampilan) setCell("program_keterampilan", bidangKeterampilan);
  }
}

/** Jalankan SEKALI dari editor Apps Script agar sinkronisasi berjalan otomatis tiap hari jam 02:00 */
function createMoodleSyncTrigger() {
  // Hapus trigger lama bernama sama supaya tidak dobel bila dijalankan ulang
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "syncFromMoodle") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncFromMoodle").timeBased().everyDays(1).atHour(2).create();
}
