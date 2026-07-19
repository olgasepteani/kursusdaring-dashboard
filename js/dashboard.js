/* ==========================================================================
   dashboard.js — controller utama halaman index.html
   ========================================================================== */

let ALL_DATA = [];
let dataTable = null;

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSidebarToggle();
  initApiSettingsUi();
  showSpinner(true);
  try {
    const [data, referensi] = await Promise.all([Api.getAllLkp(), Api.getReferensi().catch(() => null)]);
    ALL_DATA = data;
    readFiltersFromUrl();
    populateFilterOptions(ALL_DATA, referensi);
    applyFilterValuesToInputs();
    wireFilterEvents();
    wireGlobalSearch();
    initTable();
    runFilterAndRender(true);
    if (IS_DEMO_MODE) showDemoBanner();
  } catch (err) {
    console.error(err);
    toast("Gagal memuat data: " + err.message, "danger");
  } finally {
    showSpinner(false);
  }
});

/* ---------------------------------------------------------------------- */
function applyFilterValuesToInputs() {
  document.getElementById("fltProvinsi").value = FilterState.provinsi;
  document.getElementById("fltProvinsi").dispatchEvent(new Event("change"));
  document.getElementById("fltKabKota").value = FilterState.kabkota;
  document.getElementById("fltProgram").value = FilterState.program;
  document.getElementById("fltStatusBimtek").value = FilterState.statusBimtek;
  document.getElementById("fltStatusKelas").value = FilterState.statusKelas;
  document.getElementById("fltTahun").value = FilterState.tahunBimtek;
  document.getElementById("fltPesertaMin").value = FilterState.pesertaMin;
  document.getElementById("fltLulusanMin").value = FilterState.lulusanMin;
  document.getElementById("globalSearch").value = FilterState.keyword;
}

function wireFilterEvents() {
  const bind = (id, key, evt = "change") => {
    document.getElementById(id).addEventListener(evt, (e) => {
      FilterState[key] = e.target.value;
      runFilterAndRender();
    });
  };
  bind("fltProvinsi", "provinsi");
  bind("fltKabKota", "kabkota");
  bind("fltProgram", "program");
  bind("fltStatusBimtek", "statusBimtek");
  bind("fltStatusKelas", "statusKelas");
  bind("fltTahun", "tahunBimtek");
  bind("fltPesertaMin", "pesertaMin", "input");
  bind("fltLulusanMin", "lulusanMin", "input");

  document.getElementById("btnResetFilter").addEventListener("click", () => {
    Object.keys(FilterState).forEach((k) => (FilterState[k] = ""));
    applyFilterValuesToInputs();
    runFilterAndRender();
  });

  document.getElementById("btnCopyLink").addEventListener("click", () => {
    writeFiltersToUrl();
    navigator.clipboard.writeText(location.href).then(() => toast("Tautan dashboard (dengan filter) disalin ke clipboard", "success"));
  });

  document.getElementById("btnDownloadExcel").addEventListener("click", () => {
    exportToExcel(applyFilters(ALL_DATA));
  });
}

function wireGlobalSearch() {
  const inp = document.getElementById("globalSearch");
  let t;
  inp.addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      FilterState.keyword = e.target.value;
      runFilterAndRender();
    }, 200);
  });
}

/* ---------------------------------------------------------------------- */
function runFilterAndRender(skipUrl) {
  const filtered = applyFilters(ALL_DATA);
  renderStatCards(filtered);
  renderAllCharts(filtered);
  initMap(filtered);
  reloadTable(filtered);
  document.getElementById("resultCount").textContent = filtered.length.toLocaleString("id-ID");
  if (!skipUrl) writeFiltersToUrl();
}

/* ---------------------------------------------------------------------- */
function renderStatCards(data) {
  const nLkp = data.length;
  const provinsiSet = new Set(data.map((d) => d.provinsi).filter(Boolean));
  const kabSet = new Set(data.map((d) => d.kab_kota).filter(Boolean));
  const nKelas = data.reduce((s, d) => s + (d.jumlah_kelas || 0), 0);
  const nPeserta = data.reduce((s, d) => s + (d.jumlah_peserta || 0), 0);
  const nLulusan = data.reduce((s, d) => s + (d.jumlah_lulusan || 0), 0);
  const sudahBimtek = data.filter((d) => d.status_bimtek === "Sudah Bimtek").length;
  const belumBimtek = nLkp - sudahBimtek;
  let kelasBerjalan = 0,
    kelasBelumLengkap = 0;
  data.forEach((d) => (d.kelas || []).forEach((k) => {
    if (k.status === "Sudah Berjalan") kelasBerjalan++;
    if (k.status === "Materi Belum Lengkap") kelasBelumLengkap++;
  }));

  const cards = [
    { icon: "fa-building-columns", cls: "bg-blue", label: "Jumlah LKP", value: nLkp },
    { icon: "fa-map-location-dot", cls: "bg-cyan", label: "Jumlah Provinsi", value: provinsiSet.size },
    { icon: "fa-city", cls: "bg-purple", label: "Jumlah Kab/Kota", value: kabSet.size },
    { icon: "fa-chalkboard", cls: "bg-yellow", label: "Jumlah Kelas", value: nKelas },
    { icon: "fa-users", cls: "bg-blue", label: "Jumlah Peserta", value: nPeserta },
    { icon: "fa-user-graduate", cls: "bg-green", label: "Jumlah Lulusan", value: nLulusan },
    { icon: "fa-circle-check", cls: "bg-green", label: "Sudah Bimtek", value: sudahBimtek },
    { icon: "fa-circle-exclamation", cls: "bg-red", label: "Belum Bimtek", value: belumBimtek },
    { icon: "fa-play", cls: "bg-cyan", label: "Kelas Berjalan", value: kelasBerjalan },
    { icon: "fa-triangle-exclamation", cls: "bg-yellow", label: "Kelas Belum Lengkap", value: kelasBelumLengkap },
  ];

  document.getElementById("statGrid").innerHTML = cards
    .map(
      (c) => `
    <div class="stat-card">
      <div class="icon ${c.cls}"><i class="fa-solid ${c.icon}"></i></div>
      <div class="value">${Number(c.value).toLocaleString("id-ID")}</div>
      <div class="label">${c.label}</div>
    </div>`
    )
    .join("");
}

/* ---------------------------------------------------------------------- */
function statusBimtekBadge(r) {
  if (r.status_bimtek === "Sudah Bimtek") {
    const tahun = (r.tahun_bimtek || []).join(", ");
    return `<span class="badge-status b-green">Bimtek ${tahun}</span>`;
  }
  return `<span class="badge-status b-red">Belum Pernah Bimtek</span>`;
}

function statusKelasBadgeSummary(r) {
  if (!r.kelas || r.kelas.length === 0) return `<span class="badge-status b-gray">Belum Ada Kelas</span>`;
  const has = (s) => r.kelas.some((k) => k.status === s);
  if (has("Sudah Berjalan")) return `<span class="badge-status b-green">Sudah Berjalan</span>`;
  if (has("Materi Lengkap - Belum Ada Peserta")) return `<span class="badge-status b-yellow">Materi Lengkap</span>`;
  return `<span class="badge-status b-red">Materi Belum Lengkap</span>`;
}

function initTable() {
  dataTable = $("#lkpTable").DataTable({
    data: [],
    columns: [
      { data: "nama_lkp", render: (d, t, r) => `<span class="lkp-link" data-id="${r.id}">${escapeHtml(d)}</span>` },
      { data: "npsn" },
      { data: "provinsi" },
      { data: "kab_kota" },
      { data: "jumlah_kelas", className: "text-center" },
      { data: "jumlah_peserta", className: "text-center" },
      { data: "jumlah_lulusan", className: "text-center" },
      { data: null, render: (d, t, r) => statusBimtekBadge(r) },
      { data: null, render: (d, t, r) => statusKelasBadgeSummary(r) },
      { data: null, orderable: false, className: "text-center", render: (d, t, r) => `<button class="btn btn-sm btn-outline-secondary btn-detail" data-id="${r.id}"><i class="fa-solid fa-eye"></i></button>` },
    ],
    pageLength: 10,
    lengthMenu: [10, 25, 50, 100],
    language: {
      search: "",
      searchPlaceholder: "Cari di tabel...",
      lengthMenu: "Tampilkan _MENU_ baris",
      info: "Menampilkan _START_–_END_ dari _TOTAL_ data",
      infoEmpty: "Tidak ada data",
      infoFiltered: "(disaring dari _MAX_ total data)",
      zeroRecords: "Data tidak ditemukan",
      paginate: { previous: "‹", next: "›" },
    },
  });

  $("#lkpTable tbody").on("click", ".lkp-link, .btn-detail", function () {
    const id = $(this).data("id");
    openDetailModal(id);
  });
}

function reloadTable(filtered) {
  dataTable.clear();
  dataTable.rows.add(filtered);
  dataTable.draw();
}

/* ==========================================================================
   Detail Modal
   ========================================================================== */
function openDetailModal(id) {
  const r = ALL_DATA.find((d) => d.id === id);
  if (!r) return;
  const modalEl = document.getElementById("detailModal");
  document.getElementById("detailBody").innerHTML = renderDetailContent(r);
  new bootstrap.Modal(modalEl).show();
}

function renderDetailContent(r) {
  const kelasHtml = (r.kelas || []).length
    ? r.kelas
        .map(
          (k) => `
      <div class="kelas-card">
        <div class="top">
          <div>
            <div class="fw-semibold">${escapeHtml(k.nama_kelas)}</div>
            ${k.link ? `<a href="${escapeHtml(k.link)}" target="_blank" rel="noopener" style="font-size:.78rem;"><i class="fa-solid fa-link me-1"></i>Buka tautan kelas</a>` : `<span class="text-muted" style="font-size:.78rem;">Tautan kelas belum tersedia</span>`}
          </div>
          ${kelasBadge(k.status)}
        </div>
        <div class="d-flex gap-4 mt-2" style="font-size:.82rem;">
          <span><i class="fa-solid fa-users me-1 text-muted"></i>${k.peserta} Peserta</span>
          <span><i class="fa-solid fa-user-graduate me-1 text-muted"></i>${k.lulusan} Lulusan</span>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty-state"><i class="fa-solid fa-inbox"></i><div>Belum ada kelas terdaftar untuk LKP ini.</div></div>`;

  return `
    <div class="detail-hero">
      <div style="position:relative;">
        <div style="font-size:.72rem;opacity:.8;text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(r.npsn || "-")}</div>
        <h3 class="text-white mb-1">${escapeHtml(r.nama_lkp)}</h3>
        <div style="font-size:.85rem;opacity:.9;"><i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(r.kab_kota)}, ${escapeHtml(r.provinsi)}</div>
        <div class="detail-meta">
          <div><div class="k">Program Keterampilan</div><div>${escapeHtml(r.program_keterampilan || "-")}</div></div>
          <div><div class="k">Status Bimtek</div><div>${statusBimtekBadge(r)}</div></div>
          <div><div class="k">Jumlah Kelas</div><div>${r.jumlah_kelas}</div></div>
          <div><div class="k">Peserta / Lulusan</div><div>${r.jumlah_peserta} / ${r.jumlah_lulusan}</div></div>
        </div>
      </div>
    </div>
    <div class="mb-3">
      <div class="k text-muted" style="font-size:.72rem;text-transform:uppercase;">Alamat Lengkap</div>
      <div>${escapeHtml(r.alamat || "-")}</div>
    </div>
    <h6 class="mb-2"><i class="fa-solid fa-chalkboard-user me-1"></i>Daftar Kelas</h6>
    ${kelasHtml}
  `;
}

function kelasBadge(status) {
  if (status === "Sudah Berjalan") return `<span class="badge-status b-green">Sudah Berjalan</span>`;
  if (status === "Materi Lengkap - Belum Ada Peserta") return `<span class="badge-status b-yellow">Materi Lengkap, Belum Ada Peserta</span>`;
  return `<span class="badge-status b-red">Materi Belum Lengkap</span>`;
}

/* Tema, sidebar, spinner, toast -> lihat js/common.js (dipakai bersama index.html & admin.html) */

document.addEventListener("themechange", () => {
  if (ALL_DATA.length) renderAllCharts(applyFilters(ALL_DATA));
});
