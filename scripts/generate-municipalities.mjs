import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as xlsx from "xlsx";

const SOURCE_URL = "https://www.ine.es/daco/daco42/codmun/26codmun.xlsx";
const OUTPUT_FILE = path.resolve("src/lib/spanish-municipalities.ts");

async function downloadWorkbook(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`No se pudo descargar el fichero oficial: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function sortSpanishNames(values) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" })
  );
}

function extractMunicipalitiesAndProvinces(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const municipalities = [];
  const provinces = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: ""
    });

    const province = String(rows[1]?.[0] ?? "").trim();

    if (province) {
      provinces.push(province);
    }

    for (const row of rows.slice(3)) {
      const municipality = String(row[3] ?? "").trim();

      if (!municipality || !province) {
        continue;
      }

      municipalities.push(`${municipality} (${province})`);
    }
  }

  return {
    municipalities: sortSpanishNames(municipalities),
    provinces: sortSpanishNames(provinces)
  };
}

async function writeOutput(municipalities, provinces) {
  const municipalityLines = municipalities.map((value) => `  ${JSON.stringify(value)},`);
  const provinceLines = provinces.map((value) => `  ${JSON.stringify(value)},`);
  const content = [
    "// Fuente oficial: INE, Relacion de municipios y codigos a 1 de enero de 2026.",
    "// Generado con scripts/generate-municipalities.mjs.",
    "export const SPANISH_MUNICIPALITIES = [",
    ...municipalityLines,
    "] as const;",
    "",
    "export const SPANISH_PROVINCES = [",
    ...provinceLines,
    "] as const;",
    "",
    "export const SPANISH_LOCALITIES = [...SPANISH_PROVINCES, ...SPANISH_MUNICIPALITIES].sort((left, right) =>",
    '  left.localeCompare(right, "es", { sensitivity: "base" })',
    ");"
  ].join("\n");

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${content}\n`, "utf8");
}

async function main() {
  const buffer = await downloadWorkbook(SOURCE_URL);
  const { municipalities, provinces } = extractMunicipalitiesAndProvinces(buffer);
  await writeOutput(municipalities, provinces);
  console.log(`Municipios generados: ${municipalities.length}`);
  console.log(`Provincias generadas: ${provinces.length}`);
  console.log(`Salida: ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
