/* ==========================================================================
   laporan.js — Generator laporan (ringkasan nasional / per provinsi / per
   tahun bimtek / kustom sesuai filter aktif), dengan grafik infografis,
   export Excel, dan cetak/PDF.

   Aturan urutan yang dipakai di SEMUA tabel & grafik ringkasan: terbanyak ke
   tersedikit berdasarkan JUMLAH PESERTA (bukan jumlah LKP), dan kategori
   "tidak diketahui"/"Belum Ditentukan"/"Belum Bimtek" selalu diletakkan
   PALING BAWAH terlepas dari jumlahnya.
   ========================================================================== */

let ALL_DATA_LAPORAN = [];
let LAST_REPORT = null;
let REPORT_CHARTS = {};

const UNKNOWN_LABELS = ["Tidak diketahui", "Belum Ditentukan", "Belum ditentukan", "Belum Bimtek"];

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSidebarToggle();
  initApiSettingsUi();
  if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);
  showSpinner(true);
  try {
    const [data, referensi] = await Promise.all([Api.getAllLkp(), Api.getReferensi().catch(() => null)]);
    ALL_DATA_LAPORAN = data;
    if (IS_DEMO_MODE) showDemoBanner();
    populateFilterOptions(ALL_DATA_LAPORAN, referensi);
    populateTahunBimtekSection(ALL_DATA_LAPORAN);
    wireFilterEventsLaporan();
    wireReportTypeToggle();
    generateReport();
  } catch (err) {
    toast("Gagal memuat data: " + err.message, "danger");
  } finally {
    showSpinner(false);
  }
});

function wireFilterEventsLaporan() {
  const bind = (id, key, evt = "change") => {
    document.getElementById(id)?.addEventListener(evt, (e) => {
      FilterState[key] = e.target.value;
    });
  };
  bind("fltProvinsi", "provinsi");
  bind("fltKabKota", "kabkota");
  bind("fltProgram", "program");
  bind("fltStatusBimtek", "statusBimtek");
  bind("fltTahun", "tahunBimtek");

  document.getElementById("btnGenerateReport")?.addEventListener("click", generateReport);
  document.getElementById("btnExportReportExcel")?.addEventListener("click", exportReportToExcel);
  document.getElementById("btnPrintReport")?.addEventListener("click", () => window.print());
  document.getElementById("fltTahunBimtekSection")?.addEventListener("change", generateReport);
}

function wireReportTypeToggle() {
  document.querySelectorAll('input[name="reportType"]').forEach((el) => {
    el.addEventListener("change", () => {
      const isCustom = document.getElementById("rtKustom").checked;
      document.getElementById("filterPanelForReport").classList.toggle("d-none", !isCustom);
    });
  });
}

function currentReportType() {
  return document.querySelector('input[name="reportType"]:checked')?.value || "nasional";
}

/** Isi dropdown "Tahun Bimtek" untuk bagian LKP Dibimtek — diambil dinamis
 *  dari data yang ada (bukan di-hardcode 2025/2026), supaya tahun berikutnya
 *  otomatis ikut muncul tanpa perlu ubah kode lagi. */
function populateTahunBimtekSection(data) {
  const sel = document.getElementById("fltTahunBimtekSection");
  if (!sel) return;
  const years = [...new Set(data.flatMap((d) => d.tahun_bimtek || []))].sort((a, b) => b - a);
  sel.innerHTML = '<option value="">Semua Tahun</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join("");
}

/* ==========================================================================
   Generator inti
   ========================================================================== */
function generateReport() {
  const type = currentReportType();
  const now = new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });

  let dataForReport = ALL_DATA_LAPORAN;
  let title = "Laporan Ringkasan Nasional";
  let sub = `Seluruh data Kursus Daring LKP — dicetak ${now}`;
  let breakdownTitle = "Ringkasan per Provinsi";
  let breakdownKeyFn = (r) => r.provinsi;

  if (type === "tahun") {
    title = "Laporan per Tahun Bimtek";
    breakdownTitle = "Ringkasan per Tahun Bimtek";
    breakdownKeyFn = (r) => (r.tahun_bimtek && r.tahun_bimtek.length ? r.tahun_bimtek.join(", ") : "Belum Bimtek");
  } else if (type === "provinsi") {
    title = "Laporan per Provinsi";
    breakdownTitle = "Ringkasan per Provinsi";
    breakdownKeyFn = (r) => r.provinsi;
  } else if (type === "kustom") {
    dataForReport = applyFilters(ALL_DATA_LAPORAN);
    title = "Laporan Kustom (Sesuai Filter Aktif)";
    sub = `${describeActiveFilters()} — dicetak ${now}`;
    breakdownTitle = "Ringkasan per Provinsi (dari hasil filter)";
    breakdownKeyFn = (r) => r.provinsi;
  }

  const summary = computeSummary(dataForReport);
  const breakdown = computeBreakdown(dataForReport, breakdownKeyFn);
  const bidangBreakdown = computeBidangBreakdown(dataForReport);
  const kabKotaTop20 = computeBreakdown(dataForReport, (r) => r.kab_kota).slice(0, 20);
  const tahunFilter = document.getElementById("fltTahunBimtekSection")?.value || "";
  const bimtekBreakdown = computeBimtekBreakdown(dataForReport, tahunFilter);
  const top10Peserta = [...dataForReport].sort((a, b) => (b.jumlah_peserta || 0) - (a.jumlah_peserta || 0)).slice(0, 10);

  LAST_REPORT = { title, sub, summary, breakdownTitle, breakdown, bidangBreakdown, kabKotaTop20, bimtekBreakdown, tahunFilter, top10Peserta, detailRows: dataForReport };
  renderReportPreview(LAST_REPORT);
  renderReportCharts(LAST_REPORT);
}

function describeActiveFilters() {
  const f = FilterState;
  const parts = [];
  if (f.provinsi) parts.push(`Provinsi: ${f.provinsi}`);
  if (f.kabkota) parts.push(`Kab/Kota: ${f.kabkota}`);
  if (f.program) parts.push(`Program: ${f.program}`);
  if (f.statusBimtek) parts.push(`Status Bimtek: ${f.statusBimtek}`);
  if (f.tahunBimtek) parts.push(`Tahun Bimtek: ${f.tahunBimtek}`);
  return parts.length ? parts.join(" • ") : "Tanpa filter tambahan (seluruh data)";
}

function computeSummary(data) {
  const provinsiSet = new Set(data.map((d) => d.provinsi).filter(Boolean));
  const kabSet = new Set(data.map((d) => d.kab_kota).filter(Boolean));
  const nKelas = data.reduce((s, d) => s + (d.jumlah_kelas || 0), 0);
  const nPeserta = data.reduce((s, d) => s + (d.jumlah_peserta || 0), 0);
  const nLulusan = data.reduce((s, d) => s + (d.jumlah_lulusan || 0), 0);
  const sudahBimtek = data.filter((d) => d.status_bimtek === "Sudah Bimtek").length;
  const diMoodle = data.filter((d) => d.status_moodle === "Ya").length;
  return [
    { label: "Jumlah LKP", value: data.length },
    { label: "Jumlah Provinsi", value: provinsiSet.size },
    { label: "Jumlah Kab/Kota", value: kabSet.size },
    { label: "Jumlah Kelas", value: nKelas },
    { label: "Jumlah Peserta", value: nPeserta },
    { label: "Jumlah Lulusan", value: nLulusan },
    { label: "Sudah Bimtek", value: sudahBimtek },
    { label: "Belum Bimtek", value: data.length - sudahBimtek },
    { label: "LKP Terhubung Moodle", value: diMoodle },
  ];
}

/** Urutkan terbanyak ke tersedikit berdasar JUMLAH PESERTA, lalu pindahkan
 *  kategori "tidak diketahui" ke paling bawah terlepas dari nilainya. */
function sortByPesertaUnknownLast(arr) {
  const known = arr.filter((b) => !UNKNOWN_LABELS.includes(b.key)).sort((a, b) => b.peserta - a.peserta);
  const unknown = arr.filter((b) => UNKNOWN_LABELS.includes(b.key)).sort((a, b) => b.peserta - a.peserta);
  return [...known, ...unknown];
}

/** Breakdown umum per LKP (1 LKP = 1 kategori) berdasar keyFn */
function computeBreakdown(data, keyFn) {
  const map = new Map();
  data.forEach((r) => {
    const key = keyFn(r) || "Tidak diketahui";
    const cur = map.get(key) || { lkp: 0, kelas: 0, peserta: 0, lulusan: 0 };
    cur.lkp += 1;
    cur.kelas += r.jumlah_kelas || 0;
    cur.peserta += r.jumlah_peserta || 0;
    cur.lulusan += r.jumlah_lulusan || 0;
    map.set(key, cur);
  });
  const arr = [...map.entries()].map(([key, v]) => ({ key, ...v }));
  return sortByPesertaUnknownLast(arr);
}

/** Ringkasan per Bidang Keterampilan — dihitung dari level KELAS (bukan LKP),
 *  karena bidang keterampilan sekarang atribut per kelas. "Jumlah LKP" di sini
 *  berarti jumlah LKP unik yang punya minimal 1 kelas di bidang tersebut. */
function computeBidangBreakdown(data) {
  const map = new Map();
  data.forEach((lkp) => {
    (lkp.kelas || []).forEach((k) => {
      const key = k.program_keterampilan || "Belum Ditentukan";
      if (!map.has(key)) map.set(key, { lkpSet: new Set(), kelas: 0, peserta: 0, lulusan: 0 });
      const cur = map.get(key);
      cur.lkpSet.add(lkp.id);
      cur.kelas += 1;
      cur.peserta += k.peserta || 0;
      cur.lulusan += k.lulusan || 0;
    });
  });
  const arr = [...map.entries()].map(([key, v]) => ({ key, lkp: v.lkpSet.size, kelas: v.kelas, peserta: v.peserta, lulusan: v.lulusan }));
  return sortByPesertaUnknownLast(arr);
}

/** Ringkasan LKP Dibimtek per Tahun — 1 LKP dihitung di SETIAP tahun dia ikut
 *  bimtek. Tahun diambil dinamis dari data, jadi tahun berikutnya otomatis
 *  ikut muncul. Kalau tahunFilter diisi, hanya tampilkan tahun itu. */
function computeBimtekBreakdown(data, tahunFilter) {
  const map = new Map();
  data.forEach((lkp) => {
    const tahunList = lkp.tahun_bimtek && lkp.tahun_bimtek.length ? lkp.tahun_bimtek.map(String) : ["Belum Bimtek"];
    tahunList.forEach((tahun) => {
      if (tahunFilter && tahun !== String(tahunFilter)) return;
      const cur = map.get(tahun) || { lkp: 0, kelas: 0, peserta: 0, lulusan: 0 };
      cur.lkp += 1;
      cur.kelas += lkp.jumlah_kelas || 0;
      cur.peserta += lkp.jumlah_peserta || 0;
      cur.lulusan += lkp.jumlah_lulusan || 0;
      map.set(tahun, cur);
    });
  });
  const arr = [...map.entries()].map(([key, v]) => ({ key, ...v }));
  return sortByPesertaUnknownLast(arr);
}

/* ==========================================================================
   Render tabel ke area preview (yang sama persis akan tercetak saat Print/PDF)
   ========================================================================== */
function breakdownTableHtml(rows, keyHeader = "Kategori") {
  return `
    <table class="report-table">
      <thead><tr><th>${escapeHtml(keyHeader)}</th><th>Jumlah LKP</th><th>Jumlah Kelas</th><th>Jumlah Peserta</th><th>Jumlah Lulusan</th></tr></thead>
      <tbody>
        ${rows.map((b) => `<tr><td>${escapeHtml(b.key)}</td><td>${b.lkp}</td><td>${b.kelas}</td><td>${b.peserta}</td><td>${b.lulusan}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function chartBox(canvasId, height = 300) {
  return `<div class="chart-box" style="height:${height}px;"><canvas id="${canvasId}"></canvas></div>`;
}

function renderReportPreview(report) {
  const el = document.getElementById("reportPreview");
  const bimtekLabel = report.tahunFilter ? `LKP Dibimtek — Tahun ${escapeHtml(report.tahunFilter)}` : "LKP Dibimtek per Tahun";

  el.innerHTML = `
    <h2>${escapeHtml(report.title)}</h2>
    <p class="report-sub">${escapeHtml(report.sub)}</p>

    <div class="report-section-title">Ringkasan</div>
    <table class="report-table">
      <tbody>
        ${report.summary.map((s) => `<tr><td style="width:60%;">${escapeHtml(s.label)}</td><td><strong>${Number(s.value).toLocaleString("id-ID")}</strong></td></tr>`).join("")}
      </tbody>
    </table>

    <div class="report-section-title">${escapeHtml(report.breakdownTitle)}</div>
    ${chartBox("chartBreakdown", 340)}
    ${breakdownTableHtml(report.breakdown)}

    <div class="report-section-title">Ringkasan per Bidang Keterampilan</div>
    ${chartBox("chartBidang", 300)}
    ${breakdownTableHtml(report.bidangBreakdown, "Bidang Keterampilan")}

    <div class="report-section-title">Ringkasan per Kab/Kota (Top 20)</div>
    ${chartBox("chartKabKota", 460)}
    ${breakdownTableHtml(report.kabKotaTop20, "Kab/Kota")}

    <div class="report-section-title">${bimtekLabel}</div>
    ${chartBox("chartBimtek", 260)}
    ${breakdownTableHtml(report.bimtekBreakdown, "Tahun Bimtek")}

    <div class="report-section-title">10 LKP dengan Peserta Terbanyak</div>
    ${chartBox("chartTop10", 340)}
    <table class="report-table">
      <thead><tr><th>Nama LKP</th><th>Provinsi</th><th>Jumlah Kelas</th><th>Jumlah Peserta</th><th>Jumlah Lulusan</th></tr></thead>
      <tbody>
        ${report.top10Peserta.map((r) => `<tr><td>${escapeHtml(r.nama_lkp)}</td><td>${escapeHtml(r.provinsi || "-")}</td><td>${r.jumlah_kelas}</td><td>${r.jumlah_peserta}</td><td>${r.jumlah_lulusan}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

/* ==========================================================================
   Grafik — memakai Chart.js + chartjs-plugin-datalabels supaya angka SELALU
   tampil di atas/di ujung bar (bukan hanya saat disorot mouse), cocok untuk
   dicetak sebagai laporan infografis.
   ========================================================================== */
const REPORT_PALETTE = ["#004AAD", "#FFDE59", "#16A34A", "#0891B2", "#D97706", "#7C3AED", "#DC2626", "#059669", "#2563EB", "#DB2777"];

function destroyReportChart(key) {
  if (REPORT_CHARTS[key]) {
    REPORT_CHARTS[key].destroy();
    delete REPORT_CHARTS[key];
  }
}

function makeHorizontalBarChart(canvasId, chartKey, rows, metric = "peserta", maxBars = 12) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  destroyReportChart(chartKey);
  const top = rows.slice(0, maxBars);
  REPORT_CHARTS[chartKey] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((r) => r.key),
      datasets: [{ label: "Jumlah Peserta", data: top.map((r) => r[metric]), backgroundColor: REPORT_PALETTE[0], borderRadius: 5, maxBarThickness: 26 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#101828",
          font: { weight: "700", size: 11 },
          formatter: (v) => Number(v).toLocaleString("id-ID"),
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#E4E9F2" }, ticks: { color: "#5A6478" } },
        y: { grid: { display: false }, ticks: { color: "#101828", font: { size: 11 } } },
      },
      layout: { padding: { right: 40 } },
    },
  });
}

function renderReportCharts(report) {
  makeHorizontalBarChart("chartBreakdown", "breakdown", report.breakdown, "peserta", 12);
  makeHorizontalBarChart("chartBidang", "bidang", report.bidangBreakdown, "peserta", 8);
  makeHorizontalBarChart("chartKabKota", "kabkota", report.kabKotaTop20, "peserta", 20);
  makeHorizontalBarChart("chartBimtek", "bimtek", report.bimtekBreakdown, "peserta", 10);

  const top10AsBreakdown = report.top10Peserta.map((r) => ({ key: r.nama_lkp, peserta: r.jumlah_peserta || 0 }));
  makeHorizontalBarChart("chartTop10", "top10", top10AsBreakdown, "peserta", 10);
}

/* ==========================================================================
   Export Excel — 1 sheet per bagian laporan
   ========================================================================== */
function exportReportToExcel() {
  if (!LAST_REPORT) return;
  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(LAST_REPORT.summary.map((s) => ({ Kategori: s.label, Jumlah: s.value })));
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");

  const toRows = (arr, keyLabel) => arr.map((b) => ({ [keyLabel]: b.key, "Jumlah LKP": b.lkp, "Jumlah Kelas": b.kelas, "Jumlah Peserta": b.peserta, "Jumlah Lulusan": b.lulusan }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(LAST_REPORT.breakdown, "Kategori")), "Rincian");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(LAST_REPORT.bidangBreakdown, "Bidang Keterampilan")), "Bidang Keterampilan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(LAST_REPORT.kabKotaTop20, "Kab-Kota")), "Kab-Kota Top 20");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(LAST_REPORT.bimtekBreakdown, "Tahun Bimtek")), "LKP Dibimtek");

  const wsTop10 = XLSX.utils.json_to_sheet(
    LAST_REPORT.top10Peserta.map((r) => ({ "Nama LKP": r.nama_lkp, Provinsi: r.provinsi, "Jumlah Kelas": r.jumlah_kelas, "Jumlah Peserta": r.jumlah_peserta, "Jumlah Lulusan": r.jumlah_lulusan }))
  );
  XLSX.utils.book_append_sheet(wb, wsTop10, "Top 10 Peserta");

  const wsDetail = XLSX.utils.json_to_sheet(
    LAST_REPORT.detailRows.map((r) => ({
      "Nama LKP": r.nama_lkp,
      NPSN: r.npsn,
      Provinsi: r.provinsi,
      "Kab/Kota": r.kab_kota,
      "Jumlah Kelas": r.jumlah_kelas,
      "Jumlah Peserta": r.jumlah_peserta,
      "Jumlah Lulusan": r.jumlah_lulusan,
      "Status Bimtek": r.status_bimtek,
      "Terhubung Moodle": r.status_moodle === "Ya" ? "Ya" : "Belum",
    }))
  );
  XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Lengkap");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Laporan_Kursus_Daring_${stamp}.xlsx`);
}
