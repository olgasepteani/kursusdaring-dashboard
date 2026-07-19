/* ==========================================================================
   api.js — Lapisan komunikasi dengan backend (Google Apps Script Web App)
   Jika CONFIG.API_URL belum diisi, dashboard otomatis berjalan dalam
   MODE DEMO menggunakan data/lkp_data.json (read-only, perubahan CRUD
   hanya disimpan sementara di memori browser).
   ========================================================================== */

const CONFIG = {
  // Nilai bawaan (opsional) — bisa diisi langsung di sini oleh developer,
  // ATAU diisi oleh pengguna dari UI (tombol "Pengaturan Koneksi" di navbar),
  // yang disimpan di localStorage dan diprioritaskan di atas nilai di sini.
  // Contoh: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxx/exec"
  API_URL: "https://script.google.com/macros/s/AKfycbzFlh3O5itBYqwUA9BdDRKtx5LgNvLGDKFDgi4NF4MNCyS-0bh2DbKSRxBf7y49NQJ_/exec",

  // Nama field token admin di localStorage
  AUTH_KEY: "lkp_dashboard_auth_token",
  API_URL_KEY: "lkp_api_url",
};

/** URL API aktif saat ini: localStorage (diisi dari UI) > CONFIG.API_URL (hardcoded) */
function getApiUrl() {
  return (localStorage.getItem(CONFIG.API_URL_KEY) || CONFIG.API_URL || "").trim();
}
function setApiUrl(url) {
  if (url) localStorage.setItem(CONFIG.API_URL_KEY, url.trim());
  else localStorage.removeItem(CONFIG.API_URL_KEY);
}
function isDemoMode() {
  return !getApiUrl();
}
// Kompatibilitas untuk kode lama yang membaca IS_DEMO_MODE sebagai flag statis
// pada saat halaman dimuat (nilainya tetap dievaluasi ulang lewat isDemoMode()
// di titik-titik penting seperti dashboard.js/admin.js DOMContentLoaded).
let IS_DEMO_MODE = isDemoMode();

/* ---------- Helper: fetch GET (dipakai untuk semua endpoint baca) ---------- */
async function apiGet(action, params = {}) {
  if (isDemoMode()) return demoStore.handleGet(action, params);
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${getApiUrl()}?${qs}`, { method: "GET" });
  if (!res.ok) throw new Error(`API GET gagal (${res.status})`);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.message || "Terjadi kesalahan pada server");
  return json.data;
}

/* ---------- Helper: fetch POST (create/update/delete) ----------
   Menggunakan Content-Type: text/plain agar request dianggap "simple request"
   oleh browser sehingga tidak memicu CORS preflight (Apps Script Web App
   tidak selalu menjawab preflight OPTIONS dengan baik). Body tetap JSON. */
async function apiPost(action, payload = {}) {
  if (isDemoMode()) return demoStore.handlePost(action, payload);
  const token = localStorage.getItem(CONFIG.AUTH_KEY) || "";
  const res = await fetch(getApiUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token, payload }),
  });
  if (!res.ok) throw new Error(`API POST gagal (${res.status})`);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.message || "Terjadi kesalahan pada server");
  return json.data;
}

/** Uji koneksi cepat ke Apps Script (dipakai tombol "Tes Koneksi" di modal pengaturan) */
async function testApiConnection(url) {
  const res = await fetch(`${url}?action=getReferensi`, { method: "GET" });
  if (!res.ok) throw new Error(`Server merespons status ${res.status}`);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.message || "Server merespons dengan error");
  return true;
}

/* ==========================================================================
   Endpoint-endpoint tingkat tinggi yang dipakai halaman
   ========================================================================== */
const Api = {
  async getAllLkp() {
    return apiGet("listLkp");
  },
  async getLkpDetail(id) {
    return apiGet("getLkp", { id });
  },
  async getReferensi() {
    return apiGet("getReferensi");
  },
  async createLkp(data) {
    return apiPost("createLkp", data);
  },
  async updateLkp(id, data) {
    return apiPost("updateLkp", { id, ...data });
  },
  async deleteLkp(id) {
    return apiPost("deleteLkp", { id });
  },
  async createKelas(lkpId, kelas) {
    return apiPost("createKelas", { lkpId, ...kelas });
  },
  async updateKelas(lkpId, kelasId, kelas) {
    return apiPost("updateKelas", { lkpId, kelasId, ...kelas });
  },
  async deleteKelas(lkpId, kelasId) {
    return apiPost("deleteKelas", { lkpId, kelasId });
  },
  async login(username, password) {
    return apiPost("login", { username, password });
  },
  async importBulk(records) {
    return apiPost("importBulk", { records });
  },
};

/* ==========================================================================
   DEMO STORE — dipakai bila CONFIG.API_URL kosong.
   Memuat data/lkp_data.json sekali, lalu semua operasi CRUD berjalan
   in-memory (tidak permanen — reload halaman akan mengembalikan data awal).
   ========================================================================== */
const DEMO_DB_KEY = "lkp_demo_db_v1";
let demoPersistWarned = false;

const demoStore = (() => {
  let cache = null;
  let loadingPromise = null;

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(DEMO_DB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function persist() {
    try {
      localStorage.setItem(DEMO_DB_KEY, JSON.stringify(cache));
    } catch (err) {
      // Kemungkinan besar QuotaExceededError (dataset ~5MB mendekati batas localStorage
      // di sebagian browser). Perubahan tetap berlaku untuk sesi berjalan, hanya tidak
      // otomatis tersimpan permanen di browser ini.
      if (!demoPersistWarned) {
        demoPersistWarned = true;
        console.warn("Tidak dapat menyimpan perubahan mode demo ke localStorage:", err);
        if (typeof toast === "function") {
          toast("Perubahan tersimpan untuk sesi ini, tetapi penyimpanan lokal browser penuh sehingga tidak permanen. Hubungkan ke Google Spreadsheet agar tersimpan.", "warning");
        }
      }
    }
  }

  /** Mengembalikan dataset demo ke kondisi awal (data/lkp_data.json) */
  function reset() {
    localStorage.removeItem(DEMO_DB_KEY);
    cache = null;
    loadingPromise = null;
  }

  async function ensureLoaded() {
    if (cache) return cache;
    if (!loadingPromise) {
      const saved = loadFromLocalStorage();
      if (saved) {
        cache = saved;
        loadingPromise = Promise.resolve(cache);
      } else {
        loadingPromise = fetch("data/lkp_data.json")
          .then((r) => r.json())
          .then((data) => {
            cache = data.map((r) => ({ ...r, kelas: (r.kelas || []).map((k) => ({ ...k })) }));
            persist();
            return cache;
          });
      }
    }
    return loadingPromise;
  }

  function recalc(rec) {
    rec.jumlah_kelas = rec.kelas.length;
    rec.jumlah_peserta = rec.kelas.reduce((s, k) => s + (Number(k.peserta) || 0), 0);
    rec.jumlah_lulusan = rec.kelas.reduce((s, k) => s + (Number(k.lulusan) || 0), 0);
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  return {
    reset,
    async handleGet(action, params) {
      const data = await ensureLoaded();
      if (action === "listLkp") return data;
      if (action === "getLkp") return data.find((d) => d.id === params.id) || null;
      if (action === "getReferensi") {
        return {
          provinsi: [...new Set(data.map((d) => d.provinsi))].filter(Boolean).sort(),
          program: [...new Set(data.map((d) => d.program_keterampilan))].filter(Boolean).sort(),
        };
      }
      throw new Error("Aksi tidak dikenal: " + action);
    },
    async handlePost(action, payload) {
      const data = await ensureLoaded();
      const result = await this._mutate(action, payload, data);
      if (action !== "login") persist();
      return result;
    },
    async _mutate(action, payload, data) {
      if (action === "login") {
        if (payload.username === "admin" && payload.password === "admin123") {
          return { token: "demo-token", username: "admin" };
        }
        throw new Error("Username atau password salah");
      }
      if (action === "createLkp") {
        const rec = { id: uid("LKP"), kelas: [], jumlah_kelas: 0, jumlah_peserta: 0, jumlah_lulusan: 0, tahun_bimtek: [], status_bimtek: "Belum Bimtek", ...payload };
        data.unshift(rec);
        return rec;
      }
      if (action === "updateLkp") {
        const rec = data.find((d) => d.id === payload.id);
        if (!rec) throw new Error("Data LKP tidak ditemukan");
        Object.assign(rec, payload);
        return rec;
      }
      if (action === "deleteLkp") {
        const idx = data.findIndex((d) => d.id === payload.id);
        if (idx === -1) throw new Error("Data LKP tidak ditemukan");
        data.splice(idx, 1);
        return { deleted: true };
      }
      if (action === "createKelas") {
        const rec = data.find((d) => d.id === payload.lkpId);
        if (!rec) throw new Error("LKP tidak ditemukan");
        const k = { id: uid("K"), nama_kelas: payload.nama_kelas, link: payload.link || "", peserta: Number(payload.peserta) || 0, lulusan: Number(payload.lulusan) || 0, status: payload.status || "Materi Belum Lengkap" };
        rec.kelas.push(k);
        recalc(rec);
        return rec;
      }
      if (action === "updateKelas") {
        const rec = data.find((d) => d.id === payload.lkpId);
        if (!rec) throw new Error("LKP tidak ditemukan");
        const k = rec.kelas.find((x) => x.id === payload.kelasId);
        if (!k) throw new Error("Kelas tidak ditemukan");
        Object.assign(k, payload);
        recalc(rec);
        return rec;
      }
      if (action === "deleteKelas") {
        const rec = data.find((d) => d.id === payload.lkpId);
        if (!rec) throw new Error("LKP tidak ditemukan");
        rec.kelas = rec.kelas.filter((x) => x.id !== payload.kelasId);
        recalc(rec);
        return rec;
      }
      if (action === "importBulk") {
        payload.records.forEach((r) => data.unshift({ id: uid("LKP"), kelas: [], jumlah_kelas: 0, jumlah_peserta: 0, jumlah_lulusan: 0, tahun_bimtek: [], status_bimtek: "Belum Bimtek", ...r }));
        return { imported: payload.records.length };
      }
      throw new Error("Aksi tidak dikenal: " + action);
    },
  };
})();
