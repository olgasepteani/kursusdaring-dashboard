/* ==========================================================================
   excel.js — Download & Upload Excel memakai SheetJS (xlsx)
   ========================================================================== */

function exportToExcel(filtered) {
  const rows = filtered.map((r) => ({
    "Nama LKP": r.nama_lkp,
    NPSN: r.npsn,
    Provinsi: r.provinsi,
    "Kab/Kota": r.kab_kota,
    Alamat: r.alamat,
    "Program Keterampilan": r.program_keterampilan,
    "Jumlah Kelas": r.jumlah_kelas,
    "Jumlah Peserta": r.jumlah_peserta,
    "Jumlah Lulusan": r.jumlah_lulusan,
    "Status Bimtek": r.status_bimtek,
    "Tahun Bimtek": (r.tahun_bimtek || []).join(", "),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 32 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 40 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data LKP");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `LKP_Kursus_Daring_${stamp}.xlsx`);
}

/** Membaca file laporan peserta Moodle (CSV export dari halaman Participants),
 *  mengagregasi per kelas (course): jumlah peserta, jumlah lulusan (dari
 *  kolom "Completed" bila ada), dan bidang keterampilan (dari kolom
 *  "Bidang Keterampilan" bila ada) — lalu mengembalikan record siap kirim
 *  ke Api.importMoodleCsv(). Diagregasi di sisi klien supaya payload ke
 *  server ringkas. Kolom wajib: "Category ID number", "Course full name",
 *  "Course URL". Kolom "Completed" dan "Bidang Keterampilan" opsional —
 *  kalau tidak ada di file, lulusan tetap 0 dan bidang tetap kosong
 *  (kompatibel dengan format laporan versi lama). */
function parseMoodleReportCsv(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "string" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const required = ["Category ID number", "Course full name", "Course URL"];
      const cols = Object.keys(rows[0] || {});
      const missing = required.filter((c) => !cols.includes(c));
      if (missing.length) {
        onDone(new Error(`Kolom berikut tidak ditemukan di file: ${missing.join(", ")}. Pastikan ini file ekspor laporan Participants dari Moodle.`), null);
        return;
      }
      const adaKolomCompleted = cols.includes("Completed");
      const adaKolomBidang = cols.includes("Bidang Keterampilan");

      const agg = new Map(); // key: npsn__courseId -> {npsn, courseId, namaKelas, link, peserta, lulusan, bidang}
      rows.forEach((row) => {
        const npsn = String(row["Category ID number"] || "").trim();
        const link = String(row["Course URL"] || "").trim();
        const namaKelas = String(row["Course full name"] || "").trim();
        if (!npsn || !link) return;
        const m = link.match(/id=(\d+)/);
        const courseId = m ? m[1] : null;
        if (!courseId) return;
        const key = `${npsn}__${courseId}`;
        if (!agg.has(key)) agg.set(key, { npsn, courseId, namaKelas, link, peserta: 0, lulusan: 0, bidang: "" });
        const rec = agg.get(key);
        rec.peserta += 1;
        if (adaKolomCompleted && String(row["Completed"]).trim().toLowerCase() === "yes") rec.lulusan += 1;
        if (adaKolomBidang && !rec.bidang) {
          const b = String(row["Bidang Keterampilan"] || "").trim();
          if (b) rec.bidang = b;
        }
      });

      onDone(null, [...agg.values()]);
    } catch (err) {
      onDone(err, null);
    }
  };
  reader.readAsText(file);
}

/** Menghitung jumlah baris data (bukan header) pada file CSV — dipakai untuk
 *  laporan penerima sertifikat Custom Certificate Moodle, yang formatnya
 *  1 baris = 1 penerima, tanpa info kelas/NPSN (jadi cukup dihitung jumlah
 *  barisnya saja untuk dijadikan angka "Lulusan"). */
function countCsvRows(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "string" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      onDone(null, rows.length);
    } catch (err) {
      onDone(err, null);
    }
  };
  reader.readAsText(file);
}

function importFromExcel(file, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const records = rows
        .map((row) => {
          const nama = row["Nama LKP"] || row["nama_lkp"];
          if (!nama) return null;
          return {
            nama_lkp: String(nama),
            npsn: String(row["NPSN"] || ""),
            provinsi: String(row["Provinsi"] || ""),
            kab_kota: String(row["Kab/Kota"] || row["Kab/ Kota"] || ""),
            alamat: String(row["Alamat"] || ""),
            program_keterampilan: String(row["Program Keterampilan"] || ""),
          };
        })
        .filter(Boolean);
      onDone(null, records);
    } catch (err) {
      onDone(err, null);
    }
  };
  reader.readAsArrayBuffer(file);
}
