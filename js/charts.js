/* ==========================================================================
   charts.js — seluruh grafik Chart.js pada dashboard
   ========================================================================== */

const ChartRegistry = {};

const PALETTE = ["#004AAD", "#FFDE59", "#16A34A", "#0891B2", "#D97706", "#7C3AED", "#DC2626", "#059669", "#2563EB", "#DB2777"];

function destroyChart(key) {
  if (ChartRegistry[key]) {
    ChartRegistry[key].destroy();
    delete ChartRegistry[key];
  }
}

function countBy(data, keyFn) {
  const map = new Map();
  data.forEach((d) => {
    const k = keyFn(d) || "Tidak diketahui";
    map.set(k, (map.get(k) || 0) + 1);
  });
  return map;
}

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function chartTextColor() {
  return getComputedStyle(document.body).getPropertyValue("--text-muted").trim() || "#5A6478";
}
function gridColor() {
  return getComputedStyle(document.body).getPropertyValue("--border").trim() || "#E4E9F2";
}

function renderAllCharts(filtered) {
  renderProvinsiChart(filtered);
  renderProgramChart(filtered);
  renderStatusKelasChart(filtered);
  renderStatusBimtekChart(filtered);
  renderPesertaLulusanChart(filtered);
  renderTopProvinsiChart(filtered);
  renderTopKabChart(filtered);
}

const baseOpts = () => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: chartTextColor(), font: { family: "Inter", size: 11 } } },
    tooltip: { backgroundColor: "#101828", padding: 10, cornerRadius: 8, titleFont: { family: "Lexend" } },
  },
  scales: {
    x: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: gridColor() } },
    y: { ticks: { color: chartTextColor(), font: { size: 10 } }, grid: { color: gridColor() }, beginAtZero: true },
  },
});

function renderProvinsiChart(data) {
  const map = countBy(data, (d) => d.provinsi);
  const top = topN(map, 12);
  const ctx = document.getElementById("chartProvinsi");
  if (!ctx) return;
  destroyChart("provinsi");
  ChartRegistry.provinsi = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map((t) => t[0]), datasets: [{ label: "Jumlah LKP", data: top.map((t) => t[1]), backgroundColor: "#004AAD", borderRadius: 6, maxBarThickness: 28 }] },
    options: { ...baseOpts(), indexAxis: "y", plugins: { ...baseOpts().plugins, legend: { display: false } } },
  });
}

function renderProgramChart(data) {
  const map = countBy(data, (d) => d.program_keterampilan);
  const top = topN(map, 8);
  const ctx = document.getElementById("chartProgram");
  if (!ctx) return;
  destroyChart("program");
  ChartRegistry.program = new Chart(ctx, {
    type: "doughnut",
    data: { labels: top.map((t) => t[0]), datasets: [{ data: top.map((t) => t[1]), backgroundColor: PALETTE, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--surface") }] },
    options: { ...baseOpts(), cutout: "62%", scales: {} },
  });
}

function renderStatusKelasChart(data) {
  const buckets = { "Sudah Berjalan": 0, "Materi Lengkap - Belum Ada Peserta": 0, "Materi Belum Lengkap": 0 };
  data.forEach((r) => (r.kelas || []).forEach((k) => { if (buckets[k.status] !== undefined) buckets[k.status]++; }));
  const ctx = document.getElementById("chartStatusKelas");
  if (!ctx) return;
  destroyChart("statusKelas");
  ChartRegistry.statusKelas = new Chart(ctx, {
    type: "pie",
    data: { labels: ["Sudah Berjalan", "Materi Lengkap, Belum Ada Peserta", "Materi Belum Lengkap"], datasets: [{ data: Object.values(buckets), backgroundColor: ["#16A34A", "#D97706", "#DC2626"], borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--surface") }] },
    options: { ...baseOpts(), scales: {} },
  });
}

function renderStatusBimtekChart(data) {
  const sudah = data.filter((d) => d.status_bimtek === "Sudah Bimtek").length;
  const belum = data.length - sudah;
  const ctx = document.getElementById("chartStatusBimtek");
  if (!ctx) return;
  destroyChart("statusBimtek");
  ChartRegistry.statusBimtek = new Chart(ctx, {
    type: "doughnut",
    data: { labels: ["Sudah Bimtek", "Belum Bimtek"], datasets: [{ data: [sudah, belum], backgroundColor: ["#004AAD", "#FFDE59"], borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--surface") }] },
    options: { ...baseOpts(), cutout: "68%", scales: {} },
  });
}

function renderPesertaLulusanChart(data) {
  const map = new Map();
  data.forEach((r) => {
    const k = r.provinsi || "Tidak diketahui";
    const cur = map.get(k) || { peserta: 0, lulusan: 0 };
    cur.peserta += Number(r.jumlah_peserta) || 0;
    cur.lulusan += Number(r.jumlah_lulusan) || 0;
    map.set(k, cur);
  });
  const top = [...map.entries()].sort((a, b) => b[1].peserta - a[1].peserta).slice(0, 10);
  const ctx = document.getElementById("chartPesertaLulusan");
  if (!ctx) return;
  destroyChart("pesertaLulusan");
  ChartRegistry.pesertaLulusan = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((t) => t[0]),
      datasets: [
        { label: "Peserta", data: top.map((t) => t[1].peserta), backgroundColor: "#004AAD", borderRadius: 5, maxBarThickness: 22 },
        { label: "Lulusan", data: top.map((t) => t[1].lulusan), backgroundColor: "#FFDE59", borderRadius: 5, maxBarThickness: 22 },
      ],
    },
    options: baseOpts(),
  });
}

function renderTopProvinsiChart(data) {
  const map = countBy(data, (d) => d.provinsi);
  const top = topN(map, 10);
  renderHtmlBarList("listTopProvinsi", top);
}

function renderTopKabChart(data) {
  const map = countBy(data, (d) => d.kab_kota);
  const top = topN(map, 10);
  renderHtmlBarList("listTopKab", top);
}

function renderHtmlBarList(elId, entries) {
  const el = document.getElementById(elId);
  if (!el) return;
  const max = entries.length ? entries[0][1] : 1;
  el.innerHTML = entries
    .map(
      (e, i) => `
    <div class="d-flex align-items-center gap-2 mb-2">
      <div style="width:20px;font-size:.72rem;color:var(--text-faint);font-weight:700;">${i + 1}</div>
      <div style="flex:1;min-width:0;">
        <div class="d-flex justify-content-between" style="font-size:.78rem;">
          <span class="text-truncate" style="max-width:70%;">${escapeHtml(e[0])}</span>
          <span class="fw-semibold">${e[1]}</span>
        </div>
        <div class="progress" style="height:6px;"><div class="progress-bar" style="width:${(e[1] / max) * 100}%;"></div></div>
      </div>
    </div>`
    )
    .join("");
}
