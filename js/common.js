/* ==========================================================================
   common.js — util bersama: tema gelap/terang, sidebar mobile, spinner, toast
   ========================================================================== */

function initTheme() {
  const saved = localStorage.getItem("lkp_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", cur);
    localStorage.setItem("lkp_theme", cur);
    updateThemeIcon(cur);
    document.dispatchEvent(new Event("themechange"));
  });
}
function updateThemeIcon(mode) {
  const btn = document.getElementById("themeToggle");
  if (btn) btn.innerHTML = mode === "dark" ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

function initSidebarToggle() {
  document.getElementById("sidebarToggle")?.addEventListener("click", () => {
    document.querySelector(".sidebar")?.classList.toggle("open");
  });
}

function showSpinner(show) {
  const el = document.getElementById("spinnerOverlay");
  if (!el) return;
  el.style.display = show ? "flex" : "none";
}

function showDemoBanner() {
  const el = document.getElementById("demoBanner");
  if (el) el.classList.remove("d-none");
}

/* ==========================================================================
   Modal Pengaturan Koneksi — isi URL Apps Script langsung dari UI (tanpa
   perlu edit source code), simpan ke localStorage, dengan tombol tes koneksi
   dan tombol reset data demo.
   ========================================================================== */
function initApiSettingsUi() {
  const btn = document.getElementById("btnApiSettings");
  const modalEl = document.getElementById("apiSettingsModal");
  if (!btn || !modalEl) return;

  const input = document.getElementById("apiUrlInput");
  const statusEl = document.getElementById("apiSettingsStatus");

  btn.addEventListener("click", () => {
    input.value = getApiUrl();
    statusEl.innerHTML = "";
    new bootstrap.Modal(modalEl).show();
  });

  document.getElementById("btnTestApiUrl")?.addEventListener("click", async () => {
    const url = input.value.trim();
    if (!url) return (statusEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i>Isi URL terlebih dahulu.</span>`);
    statusEl.innerHTML = `<span class="text-muted"><span class="spinner-border spinner-border-sm me-1"></span>Menguji koneksi...</span>`;
    try {
      await testApiConnection(url);
      statusEl.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i>Berhasil terhubung ke Apps Script.</span>`;
    } catch (err) {
      statusEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i>Gagal: ${escapeHtml(err.message)}</span>`;
    }
  });

  document.getElementById("btnSaveApiUrl")?.addEventListener("click", () => {
    setApiUrl(input.value.trim());
    location.reload();
  });

  document.getElementById("btnUseDemoMode")?.addEventListener("click", () => {
    setApiUrl("");
    location.reload();
  });

  document.getElementById("btnResetDemoData")?.addEventListener("click", () => {
    if (typeof demoStore !== "undefined") demoStore.reset();
    location.reload();
  });

  updateApiStatusBadge();
}

function updateApiStatusBadge() {
  const badge = document.getElementById("apiModeBadge");
  if (!badge) return;
  if (isDemoMode()) {
    badge.innerHTML = `<i class="fa-solid fa-hard-drive me-1"></i>Mode Demo (Lokal)`;
    badge.className = "badge-status b-yellow";
  } else {
    badge.innerHTML = `<i class="fa-solid fa-cloud me-1"></i>Terhubung Google Sheets`;
    badge.className = "badge-status b-green";
  }
}

function toast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) {
    alert(message);
    return;
  }
  const id = "t" + Date.now();
  const colorMap = { success: "success", danger: "danger", info: "primary", warning: "warning" };
  container.insertAdjacentHTML(
    "beforeend",
    `<div id="${id}" class="toast align-items-center text-bg-${colorMap[type] || "primary"} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`
  );
  const t = new bootstrap.Toast(document.getElementById(id), { delay: 4000 });
  t.show();
}
