export type CaseType = "estimate" | "requisite";
export type Severity = "critical" | "high" | "medium" | "info";

export type ReviewCase = {
  id: string;
  type: CaseType;
  severity: Severity;
  title: string;
  subtitle: string;
  difference: string;
  explanation: string;
  left: Record<string, string>;
  right: Record<string, string>;
  documents: string[];
  score?: number;
  flagType?: "semantic" | "numeric" | "both";
};

export const ESTIMATE_FIELDS = ["document_id", "position_id", "page_or_sheet", "work_description", "unit", "quantity", "unit_price", "norm_ref"] as const;
export const REQUISITE_FIELDS = ["document_id", "page_or_sheet", "entity_name", "bin", "legal_address", "bank_name", "bik", "account_number"] as const;
type EstimateField = typeof ESTIMATE_FIELDS[number];
type RequisiteField = typeof REQUISITE_FIELDS[number];
export type EstimateRow = Record<EstimateField, string | number>;
export type RequisiteRow = Record<RequisiteField, string | number>;

const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const numberValue = (value: unknown) => {
  const normalized = text(value).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value: unknown) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(numberValue(value));
const percent = (a: unknown, b: unknown) => {
  const left = numberValue(a), right = numberValue(b);
  if (!left || !right) return 0;
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right));
};
const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;

const substitutions: Array<[RegExp, string]> = [
  [/\b(устройство|установка|монтаж|выполнение|работы|работа)\b/gu, " "],
  [/\b(орнату|монтаждау|жұмыстары|жұмыс|құрылғы)\b/gu, " "],
  [/бордюрн\S*|бортов\S*/gu, " бортовой "],
  [/бордюр\s+тас\S*|бортовой\s+кам\S*/gu, " бортовой камень "],
  [/бетонн\S*\s+основан\S*|бетон\s+негіз\S*/gu, " бетон основание "],
  [/песчан\S*\s+основан\S*|құм\s+негіз\S*/gu, " песок основание "],
  [/металл\S*\s+конструкц\S*|металл\s+конструкцияларын/gu, " металлоконструкция "],
  [/окраск\S*|бояу/gu, " покраска "],
  [/трубопровод\S*|құбыр\S*/gu, " трубопровод "],
  [/кабельн\S*|кабель/gu, " кабель "],
  [/оптикалық/gu, " оптический "],
  [/күштік/gu, " силовой "],
  [/дайындау/gu, " "],
];

export function normalize(value: unknown) {
  let result = text(value).toLocaleLowerCase("ru-RU").replace(/[ё]/g, "е").replace(/[«»“”'\"()\[\],.;:/\\_-]+/g, " ");
  for (const [pattern, replacement] of substitutions) result = result.replace(pattern, replacement);
  return result.replace(/\s+/g, " ").trim();
}

const unitCategory = (value: unknown) => {
  const unit = normalize(value).replace(/\s/g, "");
  if (/^(м|пм|п\.м|метр|мп)$/.test(unit)) return "length";
  if (/^(м2|м²|квм|квадратныйметр)$/.test(unit)) return "area";
  if (/^(м3|м³|кубм|кубическийметр)$/.test(unit)) return "volume";
  if (/^(кг|т|тонна|г)$/.test(unit)) return "weight";
  if (/^(шт|ед|компл|комплект)$/.test(unit)) return "count";
  return unit || "unknown";
};

const tokens = (value: unknown) => {
  const words = normalize(value).split(" ").filter((item) => item.length > 1);
  return [...words, ...words.slice(0, -1).map((item, index) => `${item}_${words[index + 1]}`)];
};
const grams = (value: unknown) => {
  const input = ` ${normalize(value).replace(/\s+/g, " ")} `;
  const result: string[] = [];
  for (let size = 3; size <= 4; size++) for (let i = 0; i <= input.length - size; i++) result.push(input.slice(i, i + size));
  return result;
};
const vectors = (docs: string[], extractor: (value: string) => string[]) => {
  const documentFrequency = new Map<string, number>();
  const all = docs.map((doc) => extractor(doc));
  for (const features of all) for (const feature of new Set(features)) documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
  return all.map((features) => {
    const counts = new Map<string, number>();
    for (const feature of features) counts.set(feature, (counts.get(feature) ?? 0) + 1);
    const vector = new Map<string, number>();
    for (const [feature, count] of counts) vector.set(feature, (1 + Math.log(count)) * (Math.log((docs.length + 1) / ((documentFrequency.get(feature) ?? 0) + 1)) + 1));
    return vector;
  });
};
const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0, normA = 0, normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0);
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
};
const similarityMatrix = (docs: string[]) => {
  const word = vectors(docs, tokens), character = vectors(docs, grams);
  return (i: number, j: number) => 0.58 * cosine(word[i], word[j]) + 0.42 * cosine(character[i], character[j]);
};

const traps = [
  ["силовой", "оптический"], ["горяч", "холод"], ["внутрен", "наруж"], ["демонтаж", "монтаж"],
  ["подающ", "обратн"], ["лев", "прав"], ["ручн", "механиз"], ["нов", "ремонт"],
];
const hasTrap = (a: string, b: string) => traps.some(([left, right]) => (a.includes(left) && b.includes(right)) || (a.includes(right) && b.includes(left)));
const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36).toUpperCase();
};
const estimatePanel = (row: EstimateRow) => ({
  "Документ": text(row.document_id), "№ позиции": text(row.position_id), "Лист / страница": text(row.page_or_sheet),
  "Наименование": text(row.work_description), "Ед. изм.": text(row.unit), "Объём": formatNumber(row.quantity),
  "Цена": `${formatNumber(row.unit_price)} ₸`, "Норма": text(row.norm_ref) || "—",
});
const requisitePanel = (row: RequisiteRow) => ({
  "Документ": text(row.document_id), "Лист / страница": text(row.page_or_sheet), "Контрагент": text(row.entity_name),
  "БИН": text(row.bin), "Адрес": text(row.legal_address), "Банк": text(row.bank_name), "БИК": text(row.bik), "ИИК": text(row.account_number),
});

export function analyzeEstimates(rows: EstimateRow[]) {
  const docs = rows.map((row) => text(row.work_description));
  const score = similarityMatrix(docs);
  const cases: ReviewCase[] = [];
  let excludedTechnicalTraps = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (text(a.document_id) === text(b.document_id) && text(a.position_id) === text(b.position_id)) continue;
    const normalizedA = normalize(a.work_description), normalizedB = normalize(b.work_description);
    const similarity = score(i, j);
    if (hasTrap(normalizedA, normalizedB)) { if (similarity >= .48) excludedTechnicalTraps++; continue; }
    const sameUnit = unitCategory(a.unit) === unitCategory(b.unit);
    const quantityDelta = percent(a.quantity, b.quantity), priceDelta = percent(a.unit_price, b.unit_price);
    const numericConflict = !sameUnit || quantityDelta > .15 || priceDelta > .15;
    const exactNorm = text(a.norm_ref) && normalize(a.norm_ref) === normalize(b.norm_ref);
    if (similarity < .56 && !exactNorm) continue;
    const differences: string[] = [];
    if (!sameUnit) differences.push(`единицы: ${text(a.unit)} ↔ ${text(b.unit)}`);
    if (quantityDelta > .001) differences.push(`объём ${pct(quantityDelta)}`);
    if (priceDelta > .001) differences.push(`цена ${pct(priceDelta)}`);
    if (!differences.length) differences.push("семантически близкие позиции");
    const severity: Severity = !sameUnit || priceDelta > .3 || quantityDelta > .3 ? "critical" : numericConflict ? "high" : similarity >= .76 ? "medium" : "info";
    const documents = [...new Set([text(a.document_id), text(b.document_id)])];
    cases.push({
      id: `EST-${hash(`${documents.join("|")}|${text(a.position_id)}|${text(b.position_id)}`)}`, type: "estimate", severity,
      title: text(a.work_description), subtitle: `${text(a.position_id)} ↔ ${text(b.position_id)} · ${documents.join(" / ")}`,
      difference: differences.join(" · "), score: Number(similarity.toFixed(3)), flagType: numericConflict ? "both" : "semantic", documents,
      explanation: `TF‑IDF сходство по словам и символьным n‑граммам: ${(similarity * 100).toFixed(1)}%. ${sameUnit ? "Категории единиц совместимы." : "Категории единиц различаются."} ${numericConflict ? "Есть числовое отклонение выше порога 15% или конфликт единиц." : "Критических числовых расхождений не найдено."} Окончательное решение принимает эксперт.`,
      left: estimatePanel(a), right: estimatePanel(b),
    });
  }
  return { cases: cases.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), excludedTechnicalTraps };
}

const nameSimilarity = (a: unknown, b: unknown) => {
  const left = normalize(a).replace(/\b(тоо|ао|ип|llp|ltd)\b/g, "").trim();
  const right = normalize(b).replace(/\b(тоо|ао|ип|llp|ltd)\b/g, "").trim();
  const leftTokens = new Set(tokens(left)), rightTokens = new Set(tokens(right));
  const intersection = [...leftTokens].filter((item) => rightTokens.has(item)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return left === right ? 1 : intersection / union;
};

export function analyzeRequisites(rows: RequisiteRow[]) {
  const cases: ReviewCase[] = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const sameBin = text(a.bin) !== "" && text(a.bin) === text(b.bin);
    const similarity = nameSimilarity(a.entity_name, b.entity_name);
    const exactName = normalize(a.entity_name) === normalize(b.entity_name);
    if (!sameBin && !exactName) continue;
    const bankConflict = normalize(a.bank_name) !== normalize(b.bank_name) || normalize(a.bik) !== normalize(b.bik) || normalize(a.account_number) !== normalize(b.account_number);
    const binConflict = exactName && text(a.bin) !== text(b.bin);
    const addressConflict = normalize(a.legal_address) !== normalize(b.legal_address);
    const nameVariation = sameBin && !exactName && similarity >= .45;
    if (!bankConflict && !binConflict && !addressConflict && !nameVariation) continue;
    let severity: Severity = "info", difference = "Вариант написания наименования";
    if (sameBin && bankConflict) { severity = "critical"; difference = "Разные банк, БИК или ИИК при одном БИН"; }
    else if (binConflict) { severity = "high"; difference = "Одинаковое наименование, разные БИН"; }
    else if (sameBin && addressConflict) { severity = "medium"; difference = "Разный юридический адрес"; }
    const documents = [...new Set([text(a.document_id), text(b.document_id)])];
    cases.push({
      id: `REQ-${hash(`${documents.join("|")}|${text(a.bin)}|${text(b.bin)}|${text(a.entity_name)}`)}`, type: "requisite", severity,
      title: text(a.entity_name), subtitle: `${text(a.document_id)} ↔ ${text(b.document_id)}`, difference, documents,
      explanation: `${sameBin ? "БИН совпадает." : "БИН различается — записи автоматически не объединены."} Сходство наименований: ${(similarity * 100).toFixed(0)}%. ${bankConflict ? "Обнаружено изменение платёжных реквизитов; перед оплатой нужна независимая проверка." : "Платёжные реквизиты совпадают."} Окончательное решение принимает эксперт.`,
      left: requisitePanel(a), right: requisitePanel(b),
    });
  }
  return { cases };
}
