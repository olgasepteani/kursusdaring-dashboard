/* ==========================================================================
   map.js — Peta interaktif Indonesia (choropleth jumlah LKP per provinsi)
   Menggunakan Leaflet + GeoJSON batas provinsi dari sumber terbuka.
   Jika GeoJSON gagal dimuat (mis. offline / domain diblokir), dashboard
   otomatis menampilkan daftar peringkat provinsi sebagai pengganti peta.
   ========================================================================== */

// Sumber batas wilayah 38 provinsi terkini (termasuk Kalimantan Utara & 4 provinsi
// pemekaran Papua). Properti nama provinsi tersedia di `PROVINSI`.
const GEOJSON_URL = "https://raw.githubusercontent.com/denyherianto/indonesia-geojson-topojson-maps-with-38-provinces/main/GeoJSON/indonesia-38-provinces.geojson";

let leafletMap = null;
let geojsonLayer = null;
let geojsonCache = null;
let mapFailed = false;

function normalizeProvName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^prov\.?\s*/, "")
    .replace(/dki\s*/, "d.k.i. ")
    .replace(/di\s*yogyakarta/, "d.i. yogyakarta")
    .replace(/[^a-z0-9. ]/g, "")
    .trim();
}

function colorScale(count, max) {
  if (count === 0) return "#EEF1F6";
  const ratio = Math.min(count / (max || 1), 1);
  // interpolasi dari primary-light -> primary
  const stops = ["#DCE8FA", "#B8D1F4", "#7FA9E8", "#3F72CC", "#004AAD"];
  const idx = Math.min(stops.length - 1, Math.floor(ratio * stops.length));
  return stops[idx];
}

async function initMap(filtered) {
  const wrap = document.getElementById("mapWrap");
  if (!wrap) return;

  if (mapFailed) {
    renderMapFallback(filtered);
    return;
  }

  try {
    if (!leafletMap) {
      leafletMap = L.map("indoMap", { scrollWheelZoom: false, attributionControl: false }).setView([-2.3, 118], 4.4);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 8 }).addTo(leafletMap);
    }
    if (!geojsonCache) {
      const res = await fetch(GEOJSON_URL);
      if (!res.ok) throw new Error("gagal memuat geojson");
      geojsonCache = await res.json();
    }
    updateMapLayer(filtered);
  } catch (err) {
    console.warn("Peta interaktif tidak tersedia, menampilkan daftar sebagai gantinya:", err);
    mapFailed = true;
    renderMapFallback(filtered);
  }
}

function buildProvinceStats(filtered) {
  const map = new Map();
  filtered.forEach((r) => {
    const key = normalizeProvName(r.provinsi);
    const cur = map.get(key) || { nama: r.provinsi, lkp: 0, kelas: 0, peserta: 0, lulusan: 0 };
    cur.lkp += 1;
    cur.kelas += r.jumlah_kelas || 0;
    cur.peserta += r.jumlah_peserta || 0;
    cur.lulusan += r.jumlah_lulusan || 0;
    map.set(key, cur);
  });
  return map;
}

function updateMapLayer(filtered) {
  const stats = buildProvinceStats(filtered);
  const max = Math.max(1, ...[...stats.values()].map((s) => s.lkp));

  if (geojsonLayer) leafletMap.removeLayer(geojsonLayer);

  geojsonLayer = L.geoJSON(geojsonCache, {
    style: (feature) => {
      const name = feature.properties.Propinsi || feature.properties.PROVINSI || feature.properties.name || feature.properties.NAME_1;
      const s = stats.get(normalizeProvName(name));
      return { fillColor: colorScale(s ? s.lkp : 0, max), weight: 1, color: "#fff", fillOpacity: 0.9 };
    },
    onEachFeature: (feature, layer) => {
      const name = feature.properties.Propinsi || feature.properties.PROVINSI || feature.properties.name || feature.properties.NAME_1;
      const s = stats.get(normalizeProvName(name));
      layer.on("mouseover", () => layer.setStyle({ weight: 2, color: "#004AAD" }));
      layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#fff" }));
      layer.bindTooltip(
        `<strong>${escapeHtml(name)}</strong><br>LKP: ${s ? s.lkp : 0}<br>Kelas: ${s ? s.kelas : 0}<br>Peserta: ${s ? s.peserta : 0}<br>Lulusan: ${s ? s.lulusan : 0}`,
        { sticky: true }
      );
      layer.on("click", () => {
        FilterState.provinsi = name;
        document.getElementById("fltProvinsi").value = name;
        document.getElementById("fltProvinsi").dispatchEvent(new Event("change"));
        runFilterAndRender();
      });
    },
  }).addTo(leafletMap);
}

function renderMapFallback(filtered) {
  const wrap = document.getElementById("mapWrap");
  const stats = [...buildProvinceStats(filtered).values()].sort((a, b) => b.lkp - a.lkp);
  const max = Math.max(1, ...stats.map((s) => s.lkp));
  wrap.innerHTML = `
    <div class="map-fallback-list">
      ${stats
        .map(
          (s) => `
        <div class="row-item">
          <span>${escapeHtml(s.nama)}</span>
          <span class="d-flex align-items-center gap-2">
            <span class="text-muted" style="font-size:.72rem;">${s.lkp} LKP</span>
            <span style="width:80px;height:7px;border-radius:20px;background:var(--surface-alt);overflow:hidden;display:inline-block;">
              <span style="display:block;height:100%;width:${(s.lkp / max) * 100}%;background:var(--primary);"></span>
            </span>
          </span>
        </div>`
        )
        .join("")}
    </div>
    <p class="text-muted mt-2 mb-0" style="font-size:.72rem;"><i class="fa-solid fa-circle-info me-1"></i>Peta interaktif tidak dapat dimuat (koneksi ke sumber peta terblokir) — menampilkan peringkat provinsi sebagai gantinya.</p>
  `;
}
