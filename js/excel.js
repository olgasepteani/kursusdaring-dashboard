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
