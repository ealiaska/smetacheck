type CaseType = "estimate" | "requisite";
type Severity = "critical" | "high" | "medium" | "info";

type AppEnv = Env & {
  REGISTRY_BASE_URL?: string;
  REGISTRY_TOKEN?: string;
};

type ReviewCase = {
  id: string;
  type: CaseType;
  severity: Severity;
  title: string;
  subtitle: string;
  difference: string;
  explanation: string;
  left: Record<string, string>;
  right: Record<string, string>;
};

const estimateCases: ReviewCase[] = [
  {
    id: "EST-001",
    type: "estimate",
    severity: "critical",
    title: "Устройство бетонного основания",
    subtitle: "1.1.5 ↔ 1.1.6 · Земляные работы",
    difference: "Объём −1,7% · цена −2,7%",
    explanation: "Наименования семантически совпадают, единица измерения и раздел одинаковы. Формулировки различаются, поэтому пара требует экспертного решения.",
    left: { "№ позиции": "1.1.5", Наименование: "Устройство бетонного основания", Раздел: "Земляные работы", "Ед. изм.": "м³", Объём: "12,000", Цена: "18 500 ₸", Источник: "Смета_Благоустройство.xlsx" },
    right: { "№ позиции": "1.1.6", Наименование: "Устройство бетонного основания (площадки)", Раздел: "Земляные работы", "Ед. изм.": "м³", Объём: "11,800", Цена: "18 200 ₸", Источник: "Смета_Благоустройство.xlsx" },
  },
  {
    id: "EST-002", type: "estimate", severity: "high", title: "Монтаж бортового камня", subtitle: "2.3.1 ↔ 2.3.8 · Благоустройство", difference: "Цена +18,4%", explanation: "Описание и единица совпадают, но цена отличается более чем на установленный порог 15%.",
    left: { "№ позиции": "2.3.1", Наименование: "Монтаж бортового камня", Раздел: "Благоустройство", "Ед. изм.": "п.м", Объём: "240,000", Цена: "4 600 ₸", Источник: "Смета_01.xlsx" },
    right: { "№ позиции": "2.3.8", Наименование: "Установка бордюрного камня", Раздел: "Благоустройство", "Ед. изм.": "п.м", Объём: "240,000", Цена: "5 446 ₸", Источник: "Смета_02.xlsx" },
  },
  {
    id: "EST-003", type: "estimate", severity: "medium", title: "Окраска металлических конструкций", subtitle: "4.1.2 ↔ 4.1.7 · Отделочные работы", difference: "Свободная RU/KZ формулировка", explanation: "Мультиязычная нормализация обнаружила близкую технологическую операцию; числовых конфликтов нет.",
    left: { "№ позиции": "4.1.2", Наименование: "Окраска металлических конструкций", Раздел: "Отделочные работы", "Ед. изм.": "м²", Объём: "85,000", Цена: "2 100 ₸", Источник: "Смета_01.xlsx" },
    right: { "№ позиции": "4.1.7", Наименование: "Металл конструкцияларын бояу", Раздел: "Әрлеу жұмыстары", "Ед. изм.": "м²", Объём: "85,000", Цена: "2 100 ₸", Источник: "Смета_02.xlsx" },
  },
];

const requisiteCases: ReviewCase[] = [
  {
    id: "REQ-001", type: "requisite", severity: "critical", title: "ТОО «Арман Құрылыс Лаб»", subtitle: "DOC-101 ↔ DOC-103", difference: "Разные банк, БИК и ИИК", explanation: "При одинаковом БИН указаны разные платёжные реквизиты. До оплаты необходимо подтвердить изменение по независимому официальному каналу.",
    left: { Контрагент: "ТОО «Арман Құрылыс Лаб»", БИН: "260101900111", Адрес: "г. Армантау, ул. Проектная, 10", Банк: "АО «Банк Орбита»", БИК: "ORBTKZ01", ИИК: "KZ100000000000000001", Источник: "DOC-101 · Договор" },
    right: { Контрагент: "ТОО «Арман Құрылыс Лаб»", БИН: "260101900111", Адрес: "г. Армантау, ул. Проектная, 10", Банк: "АО «Банк Вектор»", БИК: "VECRKZ02", ИИК: "KZ200000000000000099", Источник: "DOC-103 · Счёт" },
  },
  {
    id: "REQ-002", type: "requisite", severity: "high", title: "ТОО «Көкжиек Инжиниринг»", subtitle: "DOC-201 ↔ DOC-203", difference: "Разный БИН", explanation: "Наименование совпадает, но БИН различается. Автоматическое объединение запрещено.",
    left: { Контрагент: "ТОО «Көкжиек Инжиниринг»", БИН: "260202900222", Адрес: "г. Армантау", Банк: "АО «Банк Орбита»", БИК: "ORBTKZ01", ИИК: "KZ300000000000000010", Источник: "DOC-201" },
    right: { Контрагент: "ТОО «Көкжиек Инжиниринг»", БИН: "260202900299", Адрес: "г. Армантау", Банк: "АО «Банк Орбита»", БИК: "ORBTKZ01", ИИК: "KZ300000000000000010", Источник: "DOC-203" },
  },
  {
    id: "REQ-003", type: "requisite", severity: "medium", title: "ТОО «Арман Құрылыс Лаб»", subtitle: "DOC-101 ↔ DOC-104", difference: "Разный юридический адрес", explanation: "БИН совпадает, но адрес отличается. Требуется проверить актуальность адреса.",
    left: { Контрагент: "ТОО «Арман Құрылыс Лаб»", БИН: "260101900111", Адрес: "г. Армантау, ул. Проектная, 10", Банк: "АО «Банк Орбита»", БИК: "ORBTKZ01", ИИК: "KZ100000000000000001", Источник: "DOC-101" },
    right: { Контрагент: "ТОО «Арман Құрылыс Лаб»", БИН: "260101900111", Адрес: "г. Армантау, пр. Созидателей, 44", Банк: "АО «Банк Орбита»", БИК: "ORBTKZ01", ИИК: "KZ100000000000000001", Источник: "DOC-104" },
  },
];

const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
});

const clean = (value: unknown, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function getDecisionState(env: AppEnv, caseId: string) {
  const { results } = await env.DB.prepare("SELECT id, action, reviewer, role, comment, created_at FROM decisions WHERE case_id = ? ORDER BY id DESC").bind(caseId).all();
  const history = results ?? [];
  const latestByRole = new Map<string, Record<string, unknown>>();
  for (const item of history) if (!latestByRole.has(String(item.role))) latestByRole.set(String(item.role), item);
  const rejected = [...latestByRole.values()].some((item) => item.action === "rejected");
  const acceptedRoles = [...latestByRole.values()].filter((item) => item.action === "accepted").map((item) => item.role);
  return { status: rejected ? "rejected" : acceptedRoles.includes("expert") && acceptedRoles.includes("controller") ? "accepted" : acceptedRoles.length ? "pending_second" : "pending", acceptedRoles, history };
}

async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, service: "smetacheck", storage: "D1", registryMode: env.REGISTRY_MODE });

  if (request.method === "GET" && url.pathname === "/api/cases") {
    const type = url.searchParams.get("type") === "requisite" ? "requisite" : "estimate";
    const cases = type === "requisite" ? requisiteCases : estimateCases;
    const enriched = await Promise.all(cases.map(async (item) => ({ ...item, review: await getDecisionState(env, item.id) })));
    return json({ cases: enriched });
  }

  if (request.method === "POST" && url.pathname === "/api/decisions") {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 32_000) return json({ error: "Payload too large" }, { status: 413 });
    const body = await request.json<Record<string, unknown>>().catch(() => null);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });
    const caseId = clean(body.caseId, 64);
    const caseType = body.caseType === "requisite" ? "requisite" : body.caseType === "estimate" ? "estimate" : "";
    const action = body.action === "accepted" ? "accepted" : body.action === "rejected" ? "rejected" : "";
    const role = body.role === "controller" ? "controller" : body.role === "expert" ? "expert" : "";
    const reviewer = clean(body.reviewer, 80);
    const severity = clean(body.severity, 16);
    const comment = clean(body.comment, 1000);
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
    if (env.REGISTRY_MODE === "mock") return json({ source: "Синтетический mock", found: true, data: { bin, status: "Действующее", registeredName: bin === "260101900111" ? "ТОО «Арман Құрылыс Лаб»" : "Демонстрационный контрагент", checkedAt: new Date().toISOString() } });
    if (!env.REGISTRY_BASE_URL || !env.REGISTRY_TOKEN) return json({ error: "Официальный реестр не настроен" }, { status: 503 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${env.REGISTRY_BASE_URL.replace(/\/$/, "")}/legal-entities/${bin}`, { headers: { authorization: `Bearer ${env.REGISTRY_TOKEN}`, accept: "application/json" }, signal: controller.signal });
      if (!response.ok) return json({ error: "Registry gateway error", status: response.status }, { status: 502 });
      return json({ source: "Согласованный шлюз", found: true, data: await response.json() });
    } catch {
      return json({ error: "Registry gateway unavailable" }, { status: 502 });
    } finally { clearTimeout(timer); }
  }

  if (request.method === "POST" && url.pathname === "/api/analyze") {
    const body = await request.json<{ items?: Array<{ id?: string; name?: string; unit?: string; quantity?: number; price?: number }> }>().catch(() => null);
    const items = body?.items?.slice(0, 250) ?? [];
    if (items.length < 2) return json({ error: "Передайте минимум две позиции" }, { status: 422 });
    const tokenize = (s = "") => new Set(s.toLocaleLowerCase("ru").replace(/[^a-zа-яёәіңғүұқөһ0-9 ]/gi, " ").split(/\s+/).filter(Boolean));
    const matches: unknown[] = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j], at = tokenize(a.name), bt = tokenize(b.name);
      const intersection = [...at].filter((token) => bt.has(token)).length;
      const union = new Set([...at, ...bt]).size || 1;
      const similarity = intersection / union;
      if (similarity >= 0.5 && clean(a.unit, 20) === clean(b.unit, 20)) matches.push({ leftId: a.id ?? String(i + 1), rightId: b.id ?? String(j + 1), similarity: Number(similarity.toFixed(3)), quantityDelta: a.quantity && b.quantity ? Math.abs(a.quantity - b.quantity) / Math.max(a.quantity, b.quantity) : null, priceDelta: a.price && b.price ? Math.abs(a.price - b.price) / Math.max(a.price, b.price) : null });
    }
    return json({ engine: "edge-token-overlap-v1", matches, note: "Для production multilingual embeddings подключаются отдельным одобренным сервисом." });
  }

  return json({ error: "Not found" }, { status: 404 });
}

function secure(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("x-content-type-options", "nosniff");
  next.headers.set("x-frame-options", "DENY");
  next.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  next.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  next.headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return next;
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const response = url.pathname.startsWith("/api/") ? await handleApi(request, env) : await env.ASSETS.fetch(request);
      return secure(response);
    } catch (error) {
      console.error(JSON.stringify({ event: "request.failed", message: error instanceof Error ? error.message : "unknown" }));
      return secure(json({ error: "Internal server error" }, { status: 500 }));
    }
  },
} satisfies ExportedHandler<AppEnv>;
