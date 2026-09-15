export type ImportKind = "estimate" | "requisite";
export type CanonicalRow = Record<string, string | number>;
export type SheetImport = {
  file: string;
  sheet: string;
  headerRow: number;
  rows: number;
  mapping: Record<string, string>;
  inferred: string[];
};
export type ImportResult = { rows: CanonicalRow[]; reports: SheetImport[]; skippedSheets: string[] };

const fields = {
  estimate: ["document_id", "position_id", "page_or_sheet", "work_description", "unit", "quantity", "unit_price", "norm_ref"],
  requisite: ["document_id", "page_or_sheet", "entity_name", "bin", "legal_address", "bank_name", "bik", "account_number"],
} as const;

const aliases: Record<string, string[]> = {
  document_id: ["document id", "документ", "номер документа", "№ документа", "смета", "акт", "авр", "document", "құжат", "құжат нөмірі"],
  position_id: ["position id", "позиция", "номер позиции", "№ позиции", "№ п/п", "п/п", "шифр позиции", "item", "реттік нөмір"],
  page_or_sheet: ["page or sheet", "лист", "страница", "лист/страница", "sheet", "page", "бет", "парақ"],
  work_description: ["work description", "наименование работ", "наименование работ и затрат", "наименование", "вид работ", "описание работ", "работы и затраты", "работа", "description", "жұмыстардың атауы", "жұмыс атауы", "жұмыс"],
  unit: ["unit", "ед изм", "единица измерения", "единица", "изм", "өлшем бірлігі", "бірлік"],
  quantity: ["quantity", "количество", "кол во", "объем", "объём", "qty", "саны", "көлемі", "көлем"],
  unit_price: ["unit price", "цена за единицу", "стоимость единицы", "единичная расценка", "расценка", "цена", "бірлік бағасы", "бағасы", "құны"],
  norm_ref: ["norm ref", "обоснование", "шифр нормы", "код нормы", "норма", "норматив", "ресурсный код", "норматив коды"],
  entity_name: ["entity name", "контрагент", "наименование контрагента", "наименование организации", "организация", "поставщик", "подрядчик", "company", "ұйым атауы", "мердігер"],
  bin: ["bin", "бин", "бсн", "иин/бин", "бизнес идентификационный номер"],
  legal_address: ["legal address", "юридический адрес", "юр адрес", "адрес", "мекенжай", "заңды мекенжай"],
  bank_name: ["bank name", "банк", "наименование банка", "банк атауы"],
  bik: ["bik", "бик", "банк идентификационный код"],
  account_number: ["account number", "иик", "iban", "расчетный счет", "расчётный счёт", "номер счета", "шот нөмірі", "есепшот"],
};

const value = (input: unknown) => String(input ?? "").trim();
const header = (input: unknown) => value(input).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[«»“”'\"()\[\].,:;/\\_-]+/g, " ").replace(/\s+/g, " ").trim();
const headerScore = (raw: unknown, field: string) => {
  const candidate = header(raw);
  if (!candidate) return 0;
  let best = 0;
  for (const alias of aliases[field] ?? []) {
    const normalizedAlias = header(alias);
    if (candidate === normalizedAlias) best = Math.max(best, 100 + normalizedAlias.length);
    else if (candidate.includes(normalizedAlias) || normalizedAlias.includes(candidate)) best = Math.max(best, 45 + Math.min(candidate.length, normalizedAlias.length));
  }
  return best;
};
const isNumber = (input: unknown) => /^[-+]?\d[\d\s]*(?:[.,]\d+)?(?:\s*%|\s*₸)?$/.test(value(input));
const isUnit = (input: unknown) => /^(м|м2|м²|м3|м³|п\.?м|кг|г|т|шт|ед|компл|час|маш.?ч)$/i.test(value(input).replace(/\s/g, ""));
const isBin = (input: unknown) => /^\d{12}$/.test(value(input).replace(/\D/g, ""));
const nonEmpty = (row: unknown[]) => row.filter((cell) => value(cell)).length;

function detectHeader(matrix: unknown[][], kind: ImportKind) {
  let best = { index: -1, score: 0, mapping: {} as Record<string, number> };
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 60); rowIndex++) {
    const candidates: Array<{ field: string; column: number; score: number }> = [];
    for (const field of fields[kind]) for (let column = 0; column < matrix[rowIndex].length; column++) {
      const score = headerScore(matrix[rowIndex][column], field);
      if (score) candidates.push({ field, column, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const usedFields = new Set<string>(), usedColumns = new Set<number>(), mapping: Record<string, number> = {};
    let score = 0;
    for (const item of candidates) if (!usedFields.has(item.field) && !usedColumns.has(item.column)) {
      mapping[item.field] = item.column; usedFields.add(item.field); usedColumns.add(item.column); score += item.score;
    }
    if (score > best.score) best = { index: rowIndex, score, mapping };
  }
  return best;
}

function inferColumns(matrix: unknown[][], start: number, kind: ImportKind, mapping: Record<string, number>) {
  const sample = matrix.slice(start, start + 80).filter((row) => nonEmpty(row) >= 2);
  const width = Math.max(0, ...sample.map((row) => row.length));
  const unused = () => [...Array(width).keys()].filter((column) => !Object.values(mapping).includes(column));
  const ratio = (column: number, predicate: (input: unknown) => boolean) => sample.length ? sample.filter((row) => predicate(row[column])).length / sample.length : 0;
  const averageLength = (column: number) => sample.reduce((sum, row) => sum + value(row[column]).length, 0) / Math.max(1, sample.length);
  const inferred: string[] = [];
  const setBest = (field: string, scorer: (column: number) => number, minimum: number) => {
    if (mapping[field] !== undefined) return;
    const ranked = unused().map((column) => ({ column, score: scorer(column) })).sort((a, b) => b.score - a.score);
    if (ranked[0] && ranked[0].score >= minimum) { mapping[field] = ranked[0].column; inferred.push(field); }
  };
  if (kind === "estimate") {
    setBest("unit", (column) => ratio(column, isUnit), .45);
    setBest("position_id", (column) => ratio(column, (item) => /^\d+(?:[.\-]\d+)*$/.test(value(item))), .55);
    setBest("norm_ref", (column) => ratio(column, (item) => /\p{L}+[-\s]?\d/u.test(value(item)) && value(item).length < 32), .45);
    setBest("work_description", (column) => averageLength(column) * (1 - ratio(column, isNumber)), 12);
    const numeric = unused().map((column) => ({ column, score: ratio(column, isNumber), avg: averageLength(column) })).filter((item) => item.score >= .65).sort((a, b) => a.avg - b.avg);
    if (mapping.quantity === undefined && numeric.length) { mapping.quantity = numeric[0].column; inferred.push("quantity"); }
    if (mapping.unit_price === undefined && numeric.length > 1) { mapping.unit_price = numeric[numeric.length - 1].column; inferred.push("unit_price"); }
  } else {
    setBest("bin", (column) => ratio(column, isBin), .5);
    setBest("account_number", (column) => ratio(column, (item) => /^KZ[A-Z0-9\s-]{15,22}$/i.test(value(item))), .4);
    setBest("bik", (column) => ratio(column, (item) => /^[A-ZА-Я0-9]{8,11}$/.test(value(item).replace(/\s/g, ""))), .5);
    setBest("entity_name", (column) => averageLength(column) * (1 - ratio(column, isNumber)), 8);
  }
  return inferred;
}

export function importMatrix(matrix: unknown[][], kind: ImportKind, fileName: string, sheetName: string) {
  const detected = detectHeader(matrix, kind);
  const fallbackStart = matrix.findIndex((row) => nonEmpty(row) >= (kind === "estimate" ? 3 : 2));
  const start = detected.index >= 0 && detected.score >= 90 ? detected.index + 1 : Math.max(0, fallbackStart);
  const mapping = { ...detected.mapping };
  const inferred = inferColumns(matrix, start, kind, mapping);
  const identity = fileName.replace(/\.[^.]+$/, "");
  const result: CanonicalRow[] = [];
  for (let index = start; index < matrix.length; index++) {
    const source = matrix[index];
    const row: CanonicalRow = {};
    for (const field of fields[kind]) row[field] = mapping[field] === undefined ? "" : value(source[mapping[field]]);
    row.document_id ||= identity;
    row.page_or_sheet ||= sheetName;
    if (kind === "estimate") row.position_id ||= String(index + 1);
    const primary = kind === "estimate" ? value(row.work_description) : value(row.entity_name);
    if (primary.length < 3 || /^(итого|всего|наименование|total)$/i.test(primary)) continue;
    result.push(row);
  }
  const namedMapping = Object.fromEntries(Object.entries(mapping).map(([field, column]) => [field, value(matrix[Math.max(0, start - 1)]?.[column]) || `Колонка ${column + 1}`]));
  return { rows: result, report: { file: fileName, sheet: sheetName, headerRow: detected.index >= 0 ? detected.index + 1 : 0, rows: result.length, mapping: namedMapping, inferred } satisfies SheetImport };
}

export async function parseFlexibleFiles(files: File[], kind: ImportKind): Promise<ImportResult> {
  const XLSX = await import("xlsx");
  const rows: CanonicalRow[] = [], reports: SheetImport[] = [], skippedSheets: string[] = [];
  for (const file of files) {
    if (file.size > 10_000_000) throw new Error(`${file.name}: файл больше 10 МБ`);
    const isCsv = /\.csv$/i.test(file.name);
    const workbook = isCsv
      ? XLSX.read((await file.text()).replace(/^\uFEFF/, ""), { type: "string", cellDates: false })
      : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    for (const sheetName of workbook.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
      const parsed = importMatrix(matrix, kind, file.name, sheetName);
      if (parsed.rows.length) { rows.push(...parsed.rows); reports.push(parsed.report); }
      else skippedSheets.push(`${file.name} · ${sheetName}`);
    }
  }
  if (!rows.length) throw new Error("Не удалось найти строки работ. Проверьте, что таблица содержит наименования позиций");
  if (rows.length > 500) throw new Error("Для одного запуска разрешено не более 500 распознанных строк");
  return { rows, reports, skippedSheets };
}
