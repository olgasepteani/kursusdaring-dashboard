/* ==========================================================================
   filter.js — state & logic filter dashboard (bekerja realtime di client)
   ========================================================================== */

const FilterState = {
  provinsi: "",
  kabkota: "",
  program: "",
  statusBimtek: "",
  statusKelas: "",
  tahunBimtek: "",
  pesertaMin: "",
  lulusanMin: "",
  keyword: "",
};

/** Mengembalikan status kelas gabungan tertinggi milik 1 LKP untuk kebutuhan filter */
function lkpStatusKelasSet(rec) {
  if (!rec.kelas || rec.kelas.length === 0) return ["Belum Ada Kelas"];
  return [...new Set(rec.kelas.map((k) => k.status))];
}

function applyFilters(data) {
  const f = FilterState;
  const kw = f.keyword.trim().toLowerCase();
  return data.filter((r) => {
    if (f.provinsi && r.provinsi !== f.provinsi) return false;
    if (f.kabkota && r.kab_kota !== f.kabkota) return false;
    if (f.program && r.program_keterampilan !== f.program) return false;
    if (f.statusBimtek && r.status_bimtek !== f.statusBimtek) return false;
    if (f.statusKelas && !lkpStatusKelasSet(r).includes(f.statusKelas)) return false;
    if (f.tahunBimtek && !(r.tahun_bimtek || []).map(String).includes(f.tahunBimtek)) return false;
    if (f.pesertaMin && Number(r.jumlah_peserta) < Number(f.pesertaMin)) return false;
    if (f.lulusanMin && Number(r.jumlah_lulusan) < Number(f.lulusanMin)) return false;
    if (kw) {
      const hay = `${r.nama_lkp} ${r.npsn} ${r.alamat} ${r.provinsi} ${r.kab_kota}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/** Mengisi opsi dropdown filter dari data referensi + dataset aktual */
function populateFilterOptions(allData, referensi) {
  const provinsiSel = document.getElementById("fltProvinsi");
  const kabSel = document.getElementById("fltKabKota");
  const progSel = document.getElementById("fltProgram");
  const tahunSel = document.getElementById("fltTahun");

  const provList = referensi?.provinsi?.length ? referensi.provinsi : [...new Set(allData.map((d) => d.provinsi))].filter(Boolean).sort();
  const progList = referensi?.program?.length ? referensi.program : [...new Set(allData.map((d) => d.program_keterampilan))].filter(Boolean).sort();
  const tahunList = [...new Set(allData.flatMap((d) => d.tahun_bimtek || []))].sort();

  fillSelect(provinsiSel, provList, "Semua Provinsi");
  fillSelect(progSel, progList, "Semua Program");
  fillSelect(tahunSel, tahunList, "Semua Tahun");

  provinsiSel.addEventListener("change", () => {
    FilterState.provinsi = provinsiSel.value;
    const kabList = [...new Set(allData.filter((d) => !FilterState.provinsi || d.provinsi === FilterState.provinsi).map((d) => d.kab_kota))].filter(Boolean).sort();
    fillSelect(kabSel, kabList, "Semua Kab/Kota");
    FilterState.kabkota = "";
  });

  fillSelect(kabSel, [...new Set(allData.map((d) => d.kab_kota))].filter(Boolean).sort(), "Semua Kab/Kota");
}

function fillSelect(selectEl, items, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">${placeholder}</option>` + items.map((i) => `<option value="${escapeHtml(String(i))}">${escapeHtml(String(i))}</option>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Baca / tulis filter dari query string agar dashboard bisa dibagikan via tautan */
function readFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  ["provinsi", "kabkota", "program", "statusBimtek", "statusKelas", "tahunBimtek", "pesertaMin", "lulusanMin", "keyword"].forEach((k) => {
    if (p.has(k)) FilterState[k] = p.get(k);
  });
}

function writeFiltersToUrl() {
  const p = new URLSearchParams();
  Object.entries(FilterState).forEach(([k, v]) => {
    if (v) p.set(k, v);
  });
  const newUrl = `${location.pathname}${p.toString() ? "?" + p.toString() : ""}`;
  history.replaceState(null, "", newUrl);
}
