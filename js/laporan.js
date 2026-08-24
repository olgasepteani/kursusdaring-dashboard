/* ==========================================================================
   laporan.js — Generator laporan (ringkasan nasional / per provinsi / per
   tahun bimtek / kustom sesuai filter aktif), dengan export Excel & cetak/PDF.
   ========================================================================== */

let ALL_DATA_LAPORAN = [];
let LAST_REPORT = null; // { title, sub, summaryRows, breakdownTitle, breakdownRows, detailRows }

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSidebarToggle();
  initApiSettingsUi();
  showSpinner(true);
  try {
    const [data, referensi] = await Promise.all([Api.getAllLkp(), Api.getReferensi().catch(() => null)]);
    ALL_DATA_LAPORAN = data;
    if (IS_DEMO_MODE) showDemoBanner();
    populateFilterOptions(ALL_DATA_LAPORAN, referensi);
    wireFilterEventsLaporan();
    wireReportTypeToggle();
    generateReport(); // tampilkan laporan Ringkasan Nasional begitu halaman dibuka
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

  LAST_REPORT = { title, sub, summary, breakdownTitle, breakdown, detailRows: dataForReport };
  renderReportPreview(LAST_REPORT);
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
  return [...map.entries()].sort((a, b) => b[1].lkp - a[1].lkp).map(([key, v]) => ({ key, ...v }));
}

/* ==========================================================================
   Render ke area preview (yang sama persis akan tercetak saat Print/PDF)
   ========================================================================== */
function renderReportPreview(report) {
  const el = document.getElementById("reportPreview");
  const DETAIL_CAP = 100;
  const detailRows = report.detailRows.slice(0, DETAIL_CAP);

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
    <table class="report-table">
      <thead><tr><th>Kategori</th><th>Jumlah LKP</th><th>Jumlah Kelas</th><th>Jumlah Peserta</th><th>Jumlah Lulusan</th></tr></thead>
      <tbody>
        ${report.breakdown.map((b) => `<tr><td>${escapeHtml(b.key)}</td><td>${b.lkp}</td><td>${b.kelas}</td><td>${b.peserta}</td><td>${b.lulusan}</td></tr>`).join("")}
      </tbody>
    </table>

    <div class="report-section-title">Daftar LKP ${report.detailRows.length > DETAIL_CAP ? `(menampilkan ${DETAIL_CAP} dari ${report.detailRows.length} — unduh Excel untuk daftar lengkap)` : ""}</div>
    <table class="report-table">
      <thead><tr><th>Nama LKP</th><th>NPSN</th><th>Provinsi</th><th>Kab/Kota</th><th>Kelas</th><th>Peserta</th><th>Lulusan</th><th>Status Bimtek</th></tr></thead>
      <tbody>
        ${detailRows.map((r) => `<tr><td>${escapeHtml(r.nama_lkp)}</td><td>${escapeHtml(r.npsn)}</td><td>${escapeHtml(r.provinsi)}</td><td>${escapeHtml(r.kab_kota)}</td><td>${r.jumlah_kelas}</td><td>${r.jumlah_peserta}</td><td>${r.jumlah_lulusan}</td><td>${escapeHtml(r.status_bimtek)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

/* ==========================================================================
   Export Excel — workbook 3 sheet: Ringkasan, Breakdown, Detail (lengkap)
   ========================================================================== */
function exportReportToExcel() {
  if (!LAST_REPORT) return;
  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(LAST_REPORT.summary.map((s) => ({ Kategori: s.label, Jumlah: s.value })));
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");

  const wsBreakdown = XLSX.utils.json_to_sheet(LAST_REPORT.breakdown.map((b) => ({ Kategori: b.key, "Jumlah LKP": b.lkp, "Jumlah Kelas": b.kelas, "Jumlah Peserta": b.peserta, "Jumlah Lulusan": b.lulusan })));
  XLSX.utils.book_append_sheet(wb, wsBreakdown, "Rincian");

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
