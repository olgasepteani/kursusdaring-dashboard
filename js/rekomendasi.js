/* ==========================================================================
   rekomendasi.js — Rekomendasi otomatis berbasis data (bukan AI generatif).
   Semua insight dihitung langsung dari data LKP/Kelas yang sedang aktif,
   memakai aturan sederhana yang transparan (bisa dijelaskan ke siapa saja
   angkanya dari mana), bukan narasi buatan model bahasa.
   ========================================================================== */

let ALL_DATA_REKOM = [];

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSidebarToggle();
  initApiSettingsUi();
  showSpinner(true);
  try {
    ALL_DATA_REKOM = await Api.getAllLkp();
    if (IS_DEMO_MODE) showDemoBanner();
    renderRekomendasi(ALL_DATA_REKOM);
    document.getElementById("lastUpdated").textContent = new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
  } catch (err) {
    toast("Gagal memuat data: " + err.message, "danger");
  } finally {
    showSpinner(false);
  }
});

function renderRekomendasi(data) {
  const wrap = document.getElementById("insightGrid");
  const cards = [];

  cards.push(cardProvinsiTerkecil(data));
  cards.push(cardBelumDiMoodle(data));
  cards.push(cardMateriBelumLengkap(data));
  cards.push(cardBelumAdaPeserta(data));
  cards.push(cardBelumBimtek(data));
  cards.push(cardKelulusanTerendah(data));
  cards.push(cardBidangPalingDiminati(data));
  cards.push(cardLkpTerbaik(data));

  wrap.innerHTML = cards.filter(Boolean).join("");
}

/* ---------------------------------------------------------------------- */
function cardProvinsiTerkecil(data) {
  const map = new Map();
  data.forEach((r) => { if (r.provinsi) map.set(r.provinsi, (map.get(r.provinsi) || 0) + 1); });
  if (map.size === 0) return "";
  const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
  return insightCard({
    color: "blue",
    icon: "fa-map-location-dot",
    title: "5 Provinsi dengan LKP Paling Sedikit",
    desc: "Kandidat prioritas untuk perluasan jangkauan program Kursus Daring.",
    listItems: sorted.map(([nama, n]) => ({ label: nama, value: `${n} LKP` })),
    chip: "Pertimbangkan sosialisasi tambahan",
  });
}

function cardBelumDiMoodle(data) {
  const belum = data.filter((r) => r.status_moodle !== "Ya");
  if (data.length === 0) return "";
  const pct = ((belum.length / data.length) * 100).toFixed(1);
  const perProv = new Map();
  belum.forEach((r) => { if (r.provinsi) perProv.set(r.provinsi, (perProv.get(r.provinsi) || 0) + 1); });
  const top = [...perProv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return insightCard({
    color: "yellow",
    icon: "fa-plug-circle-exclamation",
    title: "LKP Belum Terhubung ke Moodle",
    desc: `${belum.length.toLocaleString("id-ID")} dari ${data.length.toLocaleString("id-ID")} LKP (${pct}%) belum tersinkron dari platform Kursus Daring.`,
    value: belum.length.toLocaleString("id-ID"),
    listItems: top.map(([nama, n]) => ({ label: nama, value: `${n} LKP` })),
    chip: "Tindak lanjuti pendaftaran kategori Moodle",
  });
}

function cardMateriBelumLengkap(data) {
  let n = 0;
  const contoh = [];
  data.forEach((r) => (r.kelas || []).forEach((k) => {
    if (k.status === "Materi Belum Lengkap") {
      n++;
      if (contoh.length < 5) contoh.push({ label: `${k.nama_kelas} — ${r.nama_lkp}`, value: "" });
    }
  }));
  if (n === 0) return "";
  return insightCard({
    color: "red",
    icon: "fa-triangle-exclamation",
    title: "Kelas dengan Materi Belum Lengkap",
    desc: "Kelas ini belum siap diikuti peserta — perlu ditindaklanjuti ke LKP terkait.",
    value: n.toLocaleString("id-ID"),
    listItems: contoh,
    chip: "Hubungi LKP untuk melengkapi materi",
  });
}

function cardBelumAdaPeserta(data) {
  let n = 0;
  const contoh = [];
  data.forEach((r) => (r.kelas || []).forEach((k) => {
    if (k.status === "Materi Lengkap - Belum Ada Peserta") {
      n++;
      if (contoh.length < 5) contoh.push({ label: `${k.nama_kelas} — ${r.nama_lkp}`, value: "" });
    }
  }));
  if (n === 0) return "";
  return insightCard({
    color: "purple",
    icon: "fa-bullhorn",
    title: "Kelas Siap Jalan, Belum Ada Peserta",
    desc: "Materi sudah lengkap, tinggal promosi/pendaftaran peserta.",
    value: n.toLocaleString("id-ID"),
    listItems: contoh,
    chip: "Dorong sosialisasi pendaftaran",
  });
}

function cardBelumBimtek(data) {
  const belum = data.filter((r) => r.status_bimtek !== "Sudah Bimtek");
  if (data.length === 0) return "";
  const pct = ((belum.length / data.length) * 100).toFixed(1);
  const perProv = new Map();
  belum.forEach((r) => { if (r.provinsi) perProv.set(r.provinsi, (perProv.get(r.provinsi) || 0) + 1); });
  const top = [...perProv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return insightCard({
    color: "yellow",
    icon: "fa-chalkboard-user",
    title: "LKP Belum Pernah Bimtek",
    desc: `${belum.length.toLocaleString("id-ID")} dari ${data.length.toLocaleString("id-ID")} LKP (${pct}%) belum pernah mengikuti Bimtek.`,
    value: belum.length.toLocaleString("id-ID"),
    listItems: top.map(([nama, n]) => ({ label: nama, value: `${n} LKP` })),
    chip: "Prioritaskan jadwal Bimtek berikutnya",
  });
}

function cardKelulusanTerendah(data) {
  const perProv = new Map();
  data.forEach((r) => {
    if (!r.provinsi) return;
    const cur = perProv.get(r.provinsi) || { peserta: 0, lulusan: 0 };
    cur.peserta += r.jumlah_peserta || 0;
    cur.lulusan += r.jumlah_lulusan || 0;
    perProv.set(r.provinsi, cur);
  });
  // Hanya provinsi dengan cukup sampel peserta (>=20) supaya rasio tidak bias oleh data sedikit
  const withRatio = [...perProv.entries()]
    .filter(([, v]) => v.peserta >= 20)
    .map(([nama, v]) => ({ nama, ratio: v.lulusan / v.peserta, peserta: v.peserta, lulusan: v.lulusan }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 5);
  if (withRatio.length === 0) return "";
  return insightCard({
    color: "red",
    icon: "fa-chart-line",
    title: "Provinsi dengan Rasio Kelulusan Terendah",
    desc: "Dihitung dari provinsi dengan minimal 20 peserta (supaya rasio tidak bias sampel kecil).",
    listItems: withRatio.map((p) => ({ label: p.nama, value: `${(p.ratio * 100).toFixed(1)}% (${p.lulusan}/${p.peserta})` })),
    chip: "Evaluasi kualitas penyelenggaraan kelas",
  });
}

function cardBidangPalingDiminati(data) {
  const map = new Map();
  data.forEach((r) => (r.kelas || []).forEach((k) => {
    const b = k.program_keterampilan || "Belum Ditentukan";
    map.set(b, (map.get(b) || 0) + 1);
  }));
  if (map.size === 0) return "";
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const top5 = sorted.slice(0, 5);
  return insightCard({
    color: "green",
    icon: "fa-star",
    title: "Bidang Keterampilan Paling Diminati",
    desc: "Diurutkan berdasarkan jumlah kelas yang dibuka.",
    listItems: top5.map(([nama, n]) => ({ label: nama, value: `${n} kelas` })),
    chip: "Pertimbangkan sebagai prioritas pengembangan kurikulum",
  });
}

function cardLkpTerbaik(data) {
  const sorted = [...data].sort((a, b) => (b.jumlah_kelas || 0) - (a.jumlah_kelas || 0)).slice(0, 5);
  if (sorted.length === 0 || !sorted[0].jumlah_kelas) return "";
  return insightCard({
    color: "green",
    icon: "fa-medal",
    title: "LKP dengan Kelas Terbanyak",
    desc: "Apresiasi untuk LKP paling aktif membuka kelas di platform Kursus Daring.",
    listItems: sorted.map((r) => ({ label: r.nama_lkp, value: `${r.jumlah_kelas} kelas` })),
    chip: "Kandidat studi kasus/contoh praktik baik",
  });
}

/* ---------------------------------------------------------------------- */
function insightCard({ color, icon, title, desc, value, listItems, chip }) {
  return `
  <div class="insight-card insight-${color}">
    <div class="insight-icon"><i class="fa-solid ${icon}"></i></div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(desc)}</p>
    ${value ? `<div class="insight-value mb-2">${value}</div>` : ""}
    ${listItems && listItems.length ? `<ul class="insight-list mb-2">${listItems.map((li) => `<li><span>${escapeHtml(li.label)}</span><strong>${escapeHtml(li.value)}</strong></li>`).join("")}</ul>` : ""}
    <span class="insight-chip"><i class="fa-solid fa-lightbulb"></i>${escapeHtml(chip)}</span>
  </div>`;
}
