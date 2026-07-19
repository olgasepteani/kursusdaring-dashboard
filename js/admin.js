/* ==========================================================================
   admin.js — controller halaman admin.html (login + CRUD LKP & Kelas)
   ========================================================================== */

let ADMIN_DATA = [];
let adminTable = null;
let editingLkpId = null;

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSidebarToggle();
  initApiSettingsUi();
  const token = localStorage.getItem(CONFIG.AUTH_KEY);
  if (token) {
    showAdminPanel();
  } else {
    showLoginScreen();
  }
  wireLoginForm();
  wireAdminUi();
});

/* ---------------------------------------------------------------------- */
function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("d-none");
  document.getElementById("adminScreen").classList.add("d-none");
}

async function showAdminPanel() {
  document.getElementById("loginScreen").classList.add("d-none");
  document.getElementById("adminScreen").classList.remove("d-none");
  if (IS_DEMO_MODE) showDemoBanner();
  showSpinner(true);
  try {
    ADMIN_DATA = await Api.getAllLkp();
    initAdminTable();
    reloadAdminTable(ADMIN_DATA);
    document.getElementById("adminUserLabel").textContent = localStorage.getItem("lkp_admin_username") || "Admin";
  } catch (err) {
    toast("Gagal memuat data: " + err.message, "danger");
  } finally {
    showSpinner(false);
  }
}

function wireLoginForm() {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("btnLogin");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memproses...';
    try {
      const res = await Api.login(username, password);
      localStorage.setItem(CONFIG.AUTH_KEY, res.token);
      localStorage.setItem("lkp_admin_username", res.username || username);
      showAdminPanel();
    } catch (err) {
      document.getElementById("loginError").textContent = err.message;
      document.getElementById("loginError").classList.remove("d-none");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "Masuk";
    }
  });

  document.getElementById("btnLogout")?.addEventListener("click", () => {
    localStorage.removeItem(CONFIG.AUTH_KEY);
    location.reload();
  });
}

/* ==========================================================================
   Tabel Admin
   ========================================================================== */
function initAdminTable() {
  adminTable = $("#adminTable").DataTable({
    data: [],
    columns: [
      { data: "nama_lkp" },
      { data: "npsn" },
      { data: "provinsi" },
      { data: "kab_kota" },
      { data: "jumlah_kelas", className: "text-center" },
      { data: null, orderable: false, className: "text-center", render: (d, t, r) => `
        <button class="btn btn-sm btn-outline-secondary btn-edit" data-id="${r.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-soft-danger btn-delete" data-id="${r.id}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      ` },
    ],
    pageLength: 10,
    lengthMenu: [10, 25, 50, 100],
    language: { search: "", searchPlaceholder: "Cari LKP...", lengthMenu: "Tampilkan _MENU_ baris", info: "Menampilkan _START_–_END_ dari _TOTAL_ data", zeroRecords: "Data tidak ditemukan", paginate: { previous: "‹", next: "›" } },
  });

  $("#adminTable tbody").on("click", ".btn-edit", function () {
    openLkpForm($(this).data("id"));
  });
  $("#adminTable tbody").on("click", ".btn-delete", function () {
    confirmDeleteLkp($(this).data("id"));
  });
}

function reloadAdminTable(data) {
  adminTable.clear();
  adminTable.rows.add(data);
  adminTable.draw();
}

function wireAdminUi() {
  document.getElementById("btnAddLkp")?.addEventListener("click", () => openLkpForm(null));
  document.getElementById("lkpForm")?.addEventListener("submit", handleSaveLkp);
  document.getElementById("btnAddKelasRow")?.addEventListener("click", () => addKelasRow());
  document.getElementById("adminSearch")?.addEventListener("input", (e) => adminTable.search(e.target.value).draw());

  document.getElementById("btnImportExcel")?.addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importFromExcel(file, async (err, records) => {
      if (err) return toast("Gagal membaca file Excel: " + err.message, "danger");
      if (!records.length) return toast("Tidak ada baris valid ditemukan pada file.", "warning");
      Swal.fire({
        title: `Impor ${records.length} data LKP?`,
        text: "Data akan ditambahkan sebagai record baru.",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Ya, impor",
        cancelButtonText: "Batal",
        confirmButtonColor: "#004AAD",
      }).then(async (res) => {
        if (!res.isConfirmed) return;
        try {
          await Api.importBulk(records);
          toast(`${records.length} data berhasil diimpor.`, "success");
          ADMIN_DATA = await Api.getAllLkp();
          reloadAdminTable(ADMIN_DATA);
        } catch (e2) {
          toast("Gagal mengimpor: " + e2.message, "danger");
        }
      });
    });
    e.target.value = "";
  });

  document.getElementById("btnExportAdminExcel")?.addEventListener("click", () => exportToExcel(ADMIN_DATA));
}

/* ==========================================================================
   Form tambah / edit LKP (termasuk daftar kelas)
   ========================================================================== */
function openLkpForm(id) {
  editingLkpId = id;
  const isEdit = !!id;
  const rec = isEdit ? ADMIN_DATA.find((d) => d.id === id) : null;

  document.getElementById("lkpFormTitle").textContent = isEdit ? "Edit Data LKP" : "Tambah Data LKP";
  document.getElementById("f_nama_lkp").value = rec?.nama_lkp || "";
  document.getElementById("f_npsn").value = rec?.npsn || "";
  document.getElementById("f_provinsi").value = rec?.provinsi || "";
  document.getElementById("f_kab_kota").value = rec?.kab_kota || "";
  document.getElementById("f_alamat").value = rec?.alamat || "";
  document.getElementById("f_program").value = rec?.program_keterampilan || "";
  document.getElementById("f_bimtek2025").checked = !!(rec?.tahun_bimtek || []).includes(2025);
  document.getElementById("f_bimtek2026").checked = !!(rec?.tahun_bimtek || []).includes(2026);

  const kelasWrap = document.getElementById("kelasRows");
  kelasWrap.innerHTML = "";
  (rec?.kelas || []).forEach((k) => addKelasRow(k));

  new bootstrap.Modal(document.getElementById("lkpFormModal")).show();
}

function addKelasRow(kelas) {
  const wrap = document.getElementById("kelasRows");
  const rowId = "kr" + Math.random().toString(36).slice(2, 8);
  const div = document.createElement("div");
  div.className = "kelas-card";
  div.id = rowId;
  div.innerHTML = `
    <input type="hidden" class="k_id" value="${kelas?.id || ""}">
    <div class="row g-2">
      <div class="col-md-5">
        <label class="form-label">Nama Kelas</label>
        <input class="form-control form-control-sm k_nama" value="${kelas ? escapeHtml(kelas.nama_kelas) : ""}" placeholder="Contoh: Kelas Make Up" required>
      </div>
      <div class="col-md-4">
        <label class="form-label">Link Kelas</label>
        <input class="form-control form-control-sm k_link" value="${kelas ? escapeHtml(kelas.link) : ""}" placeholder="https://...">
      </div>
      <div class="col-md-1">
        <label class="form-label">Peserta</label>
        <input type="number" min="0" class="form-control form-control-sm k_peserta" value="${kelas?.peserta ?? 0}">
      </div>
      <div class="col-md-1">
        <label class="form-label">Lulusan</label>
        <input type="number" min="0" class="form-control form-control-sm k_lulusan" value="${kelas?.lulusan ?? 0}">
      </div>
      <div class="col-md-1 d-flex align-items-end">
        <button type="button" class="btn btn-sm btn-soft-danger w-100" onclick="document.getElementById('${rowId}').remove()"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  wrap.appendChild(div);
}

function statusFromCounts(peserta) {
  return peserta > 0 ? "Sudah Berjalan" : "Materi Belum Lengkap";
}

async function handleSaveLkp(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSaveLkp");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...';

  try {
    const tahun_bimtek = [];
    if (document.getElementById("f_bimtek2025").checked) tahun_bimtek.push(2025);
    if (document.getElementById("f_bimtek2026").checked) tahun_bimtek.push(2026);

    const payload = {
      nama_lkp: document.getElementById("f_nama_lkp").value.trim(),
      npsn: document.getElementById("f_npsn").value.trim(),
      provinsi: document.getElementById("f_provinsi").value.trim(),
      kab_kota: document.getElementById("f_kab_kota").value.trim(),
      alamat: document.getElementById("f_alamat").value.trim(),
      program_keterampilan: document.getElementById("f_program").value.trim(),
      tahun_bimtek,
      status_bimtek: tahun_bimtek.length ? "Sudah Bimtek" : "Belum Bimtek",
    };

    const kelas = [...document.querySelectorAll("#kelasRows .kelas-card")].map((row) => {
      const peserta = Number(row.querySelector(".k_peserta").value) || 0;
      return {
        id: row.querySelector(".k_id").value || undefined,
        nama_kelas: row.querySelector(".k_nama").value.trim(),
        link: row.querySelector(".k_link").value.trim(),
        peserta,
        lulusan: Number(row.querySelector(".k_lulusan").value) || 0,
        status: statusFromCounts(peserta),
      };
    }).filter((k) => k.nama_kelas);

    payload.kelas = kelas;
    payload.jumlah_kelas = kelas.length;
    payload.jumlah_peserta = kelas.reduce((s, k) => s + k.peserta, 0);
    payload.jumlah_lulusan = kelas.reduce((s, k) => s + k.lulusan, 0);

    if (editingLkpId) {
      await Api.updateLkp(editingLkpId, payload);
      toast("Data LKP berhasil diperbarui.", "success");
    } else {
      await Api.createLkp(payload);
      toast("Data LKP baru berhasil ditambahkan.", "success");
    }

    bootstrap.Modal.getInstance(document.getElementById("lkpFormModal"))?.hide();
    ADMIN_DATA = await Api.getAllLkp();
    reloadAdminTable(ADMIN_DATA);
  } catch (err) {
    toast("Gagal menyimpan: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Simpan";
  }
}

function confirmDeleteLkp(id) {
  const rec = ADMIN_DATA.find((d) => d.id === id);
  Swal.fire({
    title: `Hapus "${rec?.nama_lkp || ""}"?`,
    text: "Tindakan ini tidak dapat dibatalkan.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, hapus",
    cancelButtonText: "Batal",
    confirmButtonColor: "#DC2626",
  }).then(async (res) => {
    if (!res.isConfirmed) return;
    try {
      await Api.deleteLkp(id);
      toast("Data LKP dihapus.", "success");
      ADMIN_DATA = await Api.getAllLkp();
      reloadAdminTable(ADMIN_DATA);
    } catch (err) {
      toast("Gagal menghapus: " + err.message, "danger");
    }
  });
}
