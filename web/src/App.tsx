import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Database, FileSearch, FileSpreadsheet, RefreshCw, Search, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";

type Kind = "estimate" | "requisite";
type Severity = "critical" | "high" | "medium" | "info";
type ReviewStatus = "pending" | "pending_second" | "accepted" | "rejected";
type Review = { status: ReviewStatus; acceptedRoles: string[]; history: Array<Record<string, string>> };
type CaseItem = {
  id: string; type: Kind; severity: Severity; title: string; subtitle: string; difference: string; explanation: string;
  left: Record<string, string>; right: Record<string, string>; documents?: string[]; score?: number; flagType?: "semantic" | "numeric" | "both"; review: Review;
};
type AnalysisResponse = { cases?: CaseItem[]; error?: string; excludedTechnicalTraps?: number; engine?: string };

const schemas = {
  estimate: ["document_id", "position_id", "page_or_sheet", "work_description", "unit", "quantity", "unit_price", "norm_ref"],
  requisite: ["document_id", "page_or_sheet", "entity_name", "bin", "legal_address", "bank_name", "bik", "account_number"],
} as const;
const severityLabel: Record<Severity, string> = { critical: "Критично", high: "Высокий", medium: "Средний", info: "Инфо" };
const statusLabel: Record<ReviewStatus, string> = { pending: "Ожидает", pending_second: "Нужна 2-я роль", accepted: "Подтверждено", rejected: "Отклонено" };
const emptyReview = (): Review => ({ status: "pending", acceptedRoles: [], history: [] });

function RecordPanel({ title, tone, values }: { title: string; tone: "blue" | "red"; values: Record<string, string> }) {
  return <section className={`record record-${tone}`}><h3>{title}</h3><dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || "—"}</dd></div>)}</dl></section>;
}

async function parseFiles(files: File[], kind: Kind) {
  const XLSX = await import("xlsx");
  const rows: Array<Record<string, string | number>> = [];
  for (const file of files) {
    if (file.size > 5_000_000) throw new Error(`${file.name}: файл больше 5 МБ`);
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    for (const sheetName of workbook.SheetNames) {
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "", raw: false });
      for (const source of parsed) {
        const normalized = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.trim().replace(/^\uFEFF/, "").toLowerCase(), typeof value === "number" ? value : String(value ?? "").trim()]));
        if (Object.values(normalized).some((value) => String(value).trim())) rows.push(normalized);
      }
    }
  }
  if (!rows.length) throw new Error("В выбранных файлах нет строк данных");
  const missing = schemas[kind].filter((field) => !Object.hasOwn(rows[0], field));
  if (missing.length) throw new Error(`Не хватает колонок: ${missing.join(", ")}`);
  if (rows.length > 500) throw new Error("Для одного запуска разрешено не более 500 строк");
  return rows;
}

function App() {
  const [kind, setKind] = useState<Kind>("estimate");
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [reviewer, setReviewer] = useState("Эксперт 1");
  const [role, setRole] = useState<"expert" | "controller">("expert");
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [usingUpload, setUsingUpload] = useState(false);
  const [registry, setRegistry] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDemo = async (nextKind: Kind = kind) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/cases?type=${nextKind}`);
      const data = await response.json() as AnalysisResponse;
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить данные");
      setCases(data.cases ?? []); setSelectedId(data.cases?.[0]?.id ?? ""); setUsingUpload(false); setFileNames([]);
      setNotice("Загружены безопасные синтетические демо-данные");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ошибка API"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadDemo(kind); }, [kind]);
  const documents = useMemo(() => [...new Set(cases.flatMap((item) => item.documents ?? []))].sort(), [cases]);
  const filtered = useMemo(() => cases.filter((item) => {
    const haystack = `${item.title} ${item.subtitle} ${item.difference} ${Object.values(item.left).join(" ")} ${Object.values(item.right).join(" ")}`.toLocaleLowerCase("ru");
    return (!query || haystack.includes(query.toLocaleLowerCase("ru"))) && (severity === "all" || item.severity === severity) && (documentFilter === "all" || item.documents?.includes(documentFilter));
  }), [cases, query, severity, documentFilter]);
  const selected = cases.find((item) => item.id === selectedId) ?? filtered[0];

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list];
    if (kind === "estimate" && files.length > 2) { setNotice("Для смет выберите один или два файла"); return; }
    if (kind === "requisite" && files.length > 1) { setNotice("Для реестра реквизитов выберите один файл"); return; }
    setLoading(true); setNotice("Разбираем файл и выполняем проверку…");
    try {
      const rows = await parseFiles(files, kind);
      const response = await fetch(`/api/analyze/${kind === "estimate" ? "estimates" : "requisites"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json() as AnalysisResponse;
      if (!response.ok) throw new Error(data.error ?? "Анализ не выполнен");
      setCases(data.cases ?? []); setSelectedId(data.cases?.[0]?.id ?? ""); setFileNames(files.map((file) => file.name)); setUsingUpload(true); setDocumentFilter("all");
      const trapNote = data.excludedTechnicalTraps ? ` Технических ложных совпадений исключено: ${data.excludedTechnicalTraps}.` : "";
      setNotice(`Проверено ${rows.length} строк. Найдено случаев: ${data.cases?.length ?? 0}.${trapNote}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ошибка чтения файла"); }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const decide = async (action: "accepted" | "rejected") => {
    if (!selected || !reviewer.trim()) { setNotice("Укажите имя проверяющего"); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: selected.id, caseType: selected.type, severity: selected.severity, action, reviewer, role, comment }) });
      const data = await response.json() as { error?: string; review?: Review };
      if (!response.ok || !data.review) throw new Error(data.error ?? "Решение не сохранено");
      setCases((current) => current.map((item) => item.id === selected.id ? { ...item, review: data.review! } : item)); setComment("");
      setNotice(action === "accepted" ? "Решение сохранено в журнале аудита" : "Отклонение сохранено в журнале аудита");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ошибка API"); }
    finally { setLoading(false); }
  };

  const checkRegistry = async () => {
    const bin = selected?.left["БИН"];
    if (!bin) return;
    setRegistry("Проверяем…");
    try {
      const response = await fetch(`/api/registry/${bin}`); const data = await response.json() as { source?: string; data?: { status?: string }; error?: string };
      setRegistry(response.ok ? `${data.source}: ${data.data?.status ?? "ответ получен"}` : data.error ?? "Ошибка реестра");
    } catch { setRegistry("Реестр недоступен"); }
  };

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="logo"><FileSearch size={22}/></div><div><h1>СверкаСмет</h1><p>Поиск похожих позиций и конфликтов реквизитов</p></div></div><div className="top-meta"><span><ShieldCheck size={18}/> Решение принимает человек</span><span className="divider"/><span><UserRound size={18}/> {role === "expert" ? "Эксперт" : "Контролёр"}</span></div></header>
    <main>
      <nav className="tabs" aria-label="Разделы"><button className={kind === "estimate" ? "active" : ""} onClick={() => setKind("estimate")}>Позиции работ</button><button className={kind === "requisite" ? "active" : ""} onClick={() => setKind("requisite")}>Реквизиты контрагентов</button></nav>

      <section className="upload-card">
        <div className="upload-copy"><div className="upload-icon">{kind === "estimate" ? <FileSpreadsheet/> : <Building2/>}</div><div><h2>{kind === "estimate" ? "Загрузите сметы или АВР" : "Загрузите реестр реквизитов"}</h2><p>{kind === "estimate" ? "Один или два файла CSV/XLSX · до 500 строк" : "Один файл CSV/XLSX · до 500 строк"}</p></div></div>
        <div className="upload-actions"><input ref={inputRef} className="file-input" type="file" accept=".csv,.xlsx,.xls" multiple={kind === "estimate"} onChange={(event) => void uploadFiles(event.target.files)}/><button className="upload-button" disabled={loading} onClick={() => inputRef.current?.click()}><Upload size={17}/> Выбрать файл{kind === "estimate" ? "ы" : ""}</button>{usingUpload && <button className="demo-button" onClick={() => void loadDemo()}><Trash2 size={16}/> Вернуть демо</button>}</div>
        <div className="schema"><strong>Обязательные колонки:</strong> {schemas[kind].join(", ")}</div>
        {!!fileNames.length && <div className="selected-files"><Check size={15}/> {fileNames.join(" · ")}</div>}
      </section>

      <section className="toolbar">
        <label className="search-field"><span>Поиск</span><div><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "estimate" ? "Бетон, монтаж, окраска…" : "Название, БИН, документ…"}/></div></label>
        <label><span>Уровень</span><div className="select-wrap"><select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")}><option value="all">Все уровни</option><option value="critical">Критично</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="info">Инфо</option></select><ChevronDown size={16}/></div></label>
        <label><span>Документ</span><div className="select-wrap"><select value={documentFilter} onChange={(e) => setDocumentFilter(e.target.value)}><option value="all">Все документы</option>{documents.map((document) => <option key={document}>{document}</option>)}</select><ChevronDown size={16}/></div></label>
        <label><span>Проверяющий</span><input className="plain-input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></label>
        <label><span>Роль</span><div className="select-wrap"><select value={role} onChange={(e) => setRole(e.target.value as "expert" | "controller")}><option value="expert">Эксперт</option><option value="controller">Контролёр</option></select><ChevronDown size={16}/></div></label>
        <button className="refresh" onClick={() => void loadDemo()}><RefreshCw size={17}/> Демо</button>
      </section>
      {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть" onClick={() => setNotice("")}><X size={15}/></button></div>}

      <div className="workspace">
        <section className="list-pane"><div className="section-title"><div><h2>{kind === "estimate" ? "Найденные совпадения" : "Конфликты реквизитов"}</h2><p>{filtered.length} результатов для экспертной проверки</p></div><span className="api-live"><i/> API подключён</span></div><div className="table-wrap"><table><thead><tr><th>Сопоставление</th><th>{kind === "estimate" ? "Наименование" : "Контрагент"}</th><th>Расхождение</th><th>Уровень</th><th>Статус</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className={item.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><td><strong>{item.subtitle.split(" · ")[0]}</strong>{item.score !== undefined && <small>{Math.round(item.score * 100)}%</small>}</td><td>{item.title}</td><td>{item.difference}</td><td><span className={`severity ${item.severity}`}>{severityLabel[item.severity]}</span></td><td><span className={`status status-${item.review?.status ?? "pending"}`}>{statusLabel[item.review?.status ?? "pending"]}</span></td></tr>)}</tbody></table>{!loading && !filtered.length && <div className="empty">Совпадений по текущим данным и фильтрам не найдено</div>}</div></section>

        <aside className="detail-pane"><div className="detail-heading"><div><h2>Детали выбранного случая</h2><p>{selected?.subtitle}</p></div><span>{selected ? `${Math.max(1, filtered.findIndex((item) => item.id === selected.id) + 1)} из ${filtered.length}` : "—"}</span></div>{selected ? <><div className="records"><RecordPanel title="Запись A" tone="blue" values={selected.left}/><RecordPanel title="Запись B · требует проверки" tone="red" values={selected.right}/></div><section className="explanation"><h3>Объяснение</h3><p>{selected.explanation}</p></section>
          {kind === "requisite" && <section className="registry"><div><Database size={19}/><div><strong>Проверка БИН</strong><span>{registry || "Сейчас используется только безопасный синтетический источник"}</span></div></div><button onClick={() => void checkRegistry()}>Проверить</button></section>}
          <section className="decision"><div className="decision-head"><div><h3>Решение эксперта</h3><p>{selected.severity === "critical" ? "Для критичного случая нужны эксперт и контролёр" : "Решение записывается в Cloudflare D1"}</p></div><span className={`status status-${selected.review?.status ?? "pending"}`}>{statusLabel[selected.review?.status ?? "pending"]}</span></div><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Добавьте комментарий к решению"/><div className="decision-actions"><button className="accept" disabled={loading} onClick={() => void decide("accepted")}><Check size={17}/> Подтвердить</button><button className="reject" disabled={loading} onClick={() => void decide("rejected")}><X size={17}/> Отклонить</button></div>{!!selected.review?.history?.length && <details><summary>История согласования · {selected.review.history.length}</summary><div className="history">{selected.review.history.map((row, index) => <p key={index}><strong>{row.reviewer}</strong> · {row.role === "expert" ? "эксперт" : "контролёр"} · {row.action === "accepted" ? "подтверждено" : "отклонено"}<span>{row.created_at}</span></p>)}</div></details>}</section>
        </> : <div className="empty">Загрузите данные или выберите демо-пример</div>}</aside>
      </div>
    </main>
    <footer><span>СверкаСмет · MVP</span><span>Файлы анализируются без внешнего AI API · официальные реестры подключаются только после получения доступа</span></footer>
  </div>;
}
export default App;
