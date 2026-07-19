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
  getOrCreateSheet(SHEET_LKP, ["id", "npsn", "nama_lkp", "alamat", "provinsi", "kab_kota", "program_keterampilan", "status_bimtek", "tahun_bimtek", "catatan", "created_at", "updated_at"]);
  getOrCreateSheet(SHEET_KELAS, ["id", "lkp_id", "nama_kelas", "link", "peserta", "lulusan", "status"]);
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
      const all = buildLkpObjects();
      data = {
        provinsi: [...new Set(all.map((d) => d.provinsi))].filter(Boolean).sort(),
        program: [...new Set(all.map((d) => d.program_keterampilan))].filter(Boolean).sort(),
      };
    } else {
      throw new Error("Aksi tidak dikenal: " + action);
    }
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, message: err.message });
  }
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
      kelasSheet.appendRow([uid("K"), id, k.nama_kelas, k.link || "", k.peserta || 0, k.lulusan || 0, k.status || "Materi Belum Lengkap"]);
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
      kelasSheet.appendRow([k.id && String(k.id).length ? k.id : uid("K"), payload.id, k.nama_kelas, k.link || "", k.peserta || 0, k.lulusan || 0, k.status || "Materi Belum Lengkap"]);
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
  kelasSheet.appendRow([id, payload.lkpId, payload.nama_kelas, payload.link || "", payload.peserta || 0, payload.lulusan || 0, payload.status || "Materi Belum Lengkap"]);
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
