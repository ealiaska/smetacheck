import { analyzeEstimates, analyzeRequisites, ESTIMATE_FIELDS, REQUISITE_FIELDS, type EstimateRow, type RequisiteRow, type ReviewCase } from "./analysis";

type CaseType = "estimate" | "requisite";
type AppEnv = Env & { REGISTRY_BASE_URL?: string; REGISTRY_TOKEN?: string };

const demoEstimateRows: EstimateRow[] = [
  { document_id: "Смета-01", position_id: "1.1.5", page_or_sheet: "Лист 1", work_description: "Устройство бетонного основания", unit: "м3", quantity: 12, unit_price: 18500, norm_ref: "E11-01" },
  { document_id: "Смета-02", position_id: "1.1.6", page_or_sheet: "Лист 2", work_description: "Бетон негізін орнату", unit: "м³", quantity: 11.8, unit_price: 18200, norm_ref: "E11-01" },
  { document_id: "Смета-01", position_id: "2.3.1", page_or_sheet: "Лист 1", work_description: "Монтаж бортового камня", unit: "п.м", quantity: 240, unit_price: 4600, norm_ref: "E27-03" },
  { document_id: "Смета-02", position_id: "2.3.8", page_or_sheet: "Лист 2", work_description: "Установка бордюрного камня", unit: "м", quantity: 240, unit_price: 5446, norm_ref: "E27-03" },
];
const demoRequisiteRows: RequisiteRow[] = [
  { document_id: "DOC-101", page_or_sheet: "1", entity_name: "ТОО «Арман Құрылыс Лаб»", bin: "260101900111", legal_address: "г. Армантау, ул. Проектная, 10", bank_name: "АО Банк Орбита", bik: "ORBTKZ01", account_number: "KZ100000000000000001" },
  { document_id: "DOC-103", page_or_sheet: "1", entity_name: "ТОО «Арман Құрылыс Лаб»", bin: "260101900111", legal_address: "г. Армантау, ул. Проектная, 10", bank_name: "АО Банк Вектор", bik: "VECRKZ02", account_number: "KZ200000000000000099" },
  { document_id: "DOC-104", page_or_sheet: "2", entity_name: "ТОО «Арман Құрылыс Лаб»", bin: "260101900111", legal_address: "г. Армантау, пр. Созидателей, 44", bank_name: "АО Банк Орбита", bik: "ORBTKZ01", account_number: "KZ100000000000000001" },
  { document_id: "DOC-201", page_or_sheet: "1", entity_name: "ТОО Көкжиек Инжиниринг", bin: "260202900222", legal_address: "г. Армантау", bank_name: "АО Банк Орбита", bik: "ORBTKZ01", account_number: "KZ300000000000000010" },
  { document_id: "DOC-203", page_or_sheet: "1", entity_name: "ТОО Көкжиек Инжиниринг", bin: "260202900299", legal_address: "г. Армантау", bank_name: "АО Банк Орбита", bik: "ORBTKZ01", account_number: "KZ300000000000000010" },
];

const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers } });
const clean = (value: unknown, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function getDecisionState(env: AppEnv, caseId: string) {
  const { results } = await env.DB.prepare("SELECT id, action, reviewer, role, comment, severity, created_at FROM decisions WHERE case_id = ? ORDER BY id DESC").bind(caseId).all();
  const history = results ?? [];
  const latestByRole = new Map<string, Record<string, unknown>>();
  for (const item of history) if (!latestByRole.has(String(item.role))) latestByRole.set(String(item.role), item);
  const rejected = [...latestByRole.values()].some((item) => item.action === "rejected");
  const acceptedRoles = [...latestByRole.values()].filter((item) => item.action === "accepted").map((item) => item.role);
  const critical = history[0]?.severity === "critical";
  const fullyAccepted = critical ? acceptedRoles.includes("expert") && acceptedRoles.includes("controller") : acceptedRoles.length > 0;
  return { status: rejected ? "rejected" : fullyAccepted ? "accepted" : acceptedRoles.length ? "pending_second" : "pending", acceptedRoles, history };
}
const enrich = (env: AppEnv, cases: ReviewCase[]) => Promise.all(cases.map(async (item) => ({ ...item, review: await getDecisionState(env, item.id) })));
const hasFields = (row: Record<string, unknown>, fields: readonly string[]) => fields.every((field) => Object.hasOwn(row, field));

async function readRows<T extends Record<string, unknown>>(request: Request, fields: readonly string[]) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 2_000_000) return { error: json({ error: "Файл слишком большой: максимум 2 МБ данных после разбора" }, { status: 413 }) };
  const body = await request.json<{ rows?: T[] }>().catch(() => null);
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 500) return { error: json({ error: "Нужно от 2 до 500 строк" }, { status: 422 }) };
  if (!rows.every((row) => row && typeof row === "object" && hasFields(row, fields))) return { error: json({ error: `Неверная схема. Обязательные поля: ${fields.join(", ")}` }, { status: 422 }) };
  return { rows };
}

async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, service: "smetacheck", storage: "D1", registryMode: env.REGISTRY_MODE, analysis: "offline-tfidf-word-char-v2" });
  if (request.method === "GET" && url.pathname === "/api/cases") {
    const type: CaseType = url.searchParams.get("type") === "requisite" ? "requisite" : "estimate";
    const result = type === "requisite" ? analyzeRequisites(demoRequisiteRows) : analyzeEstimates(demoEstimateRows);
    return json({ cases: await enrich(env, result.cases), demo: true, excludedTechnicalTraps: "excludedTechnicalTraps" in result ? result.excludedTechnicalTraps : 0 });
  }
  if (request.method === "POST" && (url.pathname === "/api/analyze/estimates" || url.pathname === "/api/analyze")) {
    const parsed = await readRows<EstimateRow>(request, ESTIMATE_FIELDS);
    if (parsed.error) return parsed.error;
    const result = analyzeEstimates(parsed.rows!);
    return json({ ...result, cases: await enrich(env, result.cases), engine: "offline-tfidf-word-char-v2", threshold: 0.56 });
  }
  if (request.method === "POST" && url.pathname === "/api/analyze/requisites") {
    const parsed = await readRows<RequisiteRow>(request, REQUISITE_FIELDS);
    if (parsed.error) return parsed.error;
    const result = analyzeRequisites(parsed.rows!);
    return json({ ...result, cases: await enrich(env, result.cases), engine: "rules-fuzzy-v2" });
  }
  if (request.method === "POST" && url.pathname === "/api/decisions") {
    if (Number(request.headers.get("content-length") ?? "0") > 32_000) return json({ error: "Payload too large" }, { status: 413 });
    const body = await request.json<Record<string, unknown>>().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });
    const caseId = clean(body.caseId, 64), caseType = body.caseType === "requisite" ? "requisite" : body.caseType === "estimate" ? "estimate" : "";
    const action = body.action === "accepted" ? "accepted" : body.action === "rejected" ? "rejected" : "";
    const role = body.role === "controller" ? "controller" : body.role === "expert" ? "expert" : "";
    const reviewer = clean(body.reviewer, 80), severity = clean(body.severity, 16), comment = clean(body.comment, 1000);
    if (!caseId || !caseType || !action || !role || !reviewer || !["critical", "high", "medium", "info"].includes(severity)) return json({ error: "Validation failed" }, { status: 422 });
    const txId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO decisions(case_id, case_type, severity, action, reviewer, role, comment) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(caseId, caseType, severity, action, reviewer, role, comment),
      env.DB.prepare("INSERT INTO audit_events(event_type, actor, payload) VALUES (?, ?, ?)").bind("decision.created", reviewer, JSON.stringify({ txId, caseId, caseType, severity, action, role })),
    ]);
    return json({ ok: true, review: await getDecisionState(env, caseId) }, { status: 201 });
  }
  const registryMatch = url.pathname.match(/^\/api\/registry\/(\d{12})$/);
  if (request.method === "GET" && registryMatch) {
    const bin = registryMatch[1];
    if (env.REGISTRY_MODE === "mock") return json({ source: "Синтетический mock", found: true, data: { bin, status: "Демонстрационная запись", registeredName: "Демо-контрагент", checkedAt: new Date().toISOString() } });
    if (!env.REGISTRY_BASE_URL || !env.REGISTRY_TOKEN) return json({ error: "Официальный реестр не настроен" }, { status: 503 });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${env.REGISTRY_BASE_URL.replace(/\/$/, "")}/legal-entities/${bin}`, { headers: { authorization: `Bearer ${env.REGISTRY_TOKEN}`, accept: "application/json" }, signal: controller.signal });
      if (!response.ok) return json({ error: "Registry gateway error", status: response.status }, { status: 502 });
      return json({ source: "Согласованный шлюз", found: true, data: await response.json() });
    } catch { return json({ error: "Registry gateway unavailable" }, { status: 502 }); }
    finally { clearTimeout(timer); }
  }
  return json({ error: "Not found" }, { status: 404 });
}

function secure(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("x-content-type-options", "nosniff"); next.headers.set("x-frame-options", "DENY");
  next.headers.set("referrer-policy", "strict-origin-when-cross-origin"); next.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  next.headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return next;
}
export default { async fetch(request, env): Promise<Response> {
  try { const url = new URL(request.url); return secure(url.pathname.startsWith("/api/") ? await handleApi(request, env) : await env.ASSETS.fetch(request)); }
  catch (error) { console.error(JSON.stringify({ event: "request.failed", message: error instanceof Error ? error.message : "unknown" })); return secure(json({ error: "Internal server error" }, { status: 500 })); }
} } satisfies ExportedHandler<AppEnv>;
