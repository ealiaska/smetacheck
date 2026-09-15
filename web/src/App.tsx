import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Database, FileSearch, RefreshCw, Search, ShieldCheck, UserRound, X } from "lucide-react";

type Kind = "estimate" | "requisite";
type Severity = "critical" | "high" | "medium" | "info";
type ReviewStatus = "pending" | "pending_second" | "accepted" | "rejected";
type CaseItem = {
  id: string; type: Kind; severity: Severity; title: string; subtitle: string; difference: string; explanation: string;
  left: Record<string, string>; right: Record<string, string>;
  review: { status: ReviewStatus; acceptedRoles: string[]; history: Array<Record<string, string>> };
};

const severityLabel: Record<Severity, string> = { critical: "Критично", high: "Высокий", medium: "Средний", info: "Инфо" };
const statusLabel: Record<ReviewStatus, string> = { pending: "На проверке", pending_second: "Ждёт контролёра", accepted: "Подтверждено", rejected: "Отклонено" };

function RecordPanel({ title, tone, values }: { title: string; tone: "blue" | "red"; values: Record<string, string> }) {
  return <section className={`record record-${tone}`}>
    <h3>{title}</h3>
    <dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

function App() {
  const [kind, setKind] = useState<Kind>("estimate");
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [reviewer, setReviewer] = useState("demo-expert");
  const [role, setRole] = useState<"expert" | "controller">("expert");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [registry, setRegistry] = useState("");

  const loadCases = async (nextKind = kind) => {
    setLoading(true); setNotice("");
    try {
      const response = await fetch(`/api/cases?type=${nextKind}`);
      if (!response.ok) throw new Error("API недоступен");
      const data = await response.json() as { cases: CaseItem[] };
      setCases(data.cases); setSelectedId((current) => data.cases.some((item) => item.id === current) ? current : data.cases[0]?.id ?? "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadCases(); }, [kind]);
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];
  const filtered = useMemo(() => cases.filter((item) => (severity === "all" || item.severity === severity) && `${item.title} ${item.subtitle} ${item.difference}`.toLowerCase().includes(query.toLowerCase())), [cases, query, severity]);

  const decide = async (action: "accepted" | "rejected") => {
    if (!selected || !reviewer.trim()) return setNotice("Укажите имя проверяющего");
    setLoading(true);
    try {
      const response = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: selected.id, caseType: selected.type, severity: selected.severity, action, role, reviewer, comment }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Решение не сохранено");
      setComment(""); setNotice(action === "accepted" ? "Решение сохранено в журнале аудита" : "Отклонение сохранено в журнале аудита");
      await loadCases();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ошибка API"); }
    finally { setLoading(false); }
  };

  const checkRegistry = async () => {
    const bin = selected?.left.БИН;
    if (!bin) return;
    setRegistry("Проверяем…");
    try {
      const response = await fetch(`/api/registry/${bin}`); const data = await response.json() as { source?: string; data?: { status?: string }; error?: string };
      setRegistry(response.ok ? `${data.source}: ${data.data?.status ?? "ответ получен"}` : data.error ?? "Ошибка реестра");
    } catch { setRegistry("Реестр недоступен"); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="logo"><FileSearch size={22}/></div><div><h1>СверкаСмет</h1><p>Поиск похожих позиций и конфликтов реквизитов</p></div></div>
      <div className="top-meta"><span><ShieldCheck size={18}/> Решение принимает человек</span><span className="divider"/><span><UserRound size={18}/> {role === "expert" ? "Эксперт" : "Контролёр"}</span></div>
    </header>

    <main>
      <nav className="tabs" aria-label="Разделы">
        <button className={kind === "estimate" ? "active" : ""} onClick={() => setKind("estimate")}>Позиции работ</button>
        <button className={kind === "requisite" ? "active" : ""} onClick={() => setKind("requisite")}>Реквизиты контрагентов</button>
      </nav>

      <section className="toolbar">
        <label className="search-field"><span>Поиск</span><div><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "estimate" ? "Бетон, монтаж, окраска…" : "Название, БИН, документ…"}/></div></label>
        <label><span>Уровень</span><div className="select-wrap"><select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")}><option value="all">Все уровни</option><option value="critical">Критично</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="info">Инфо</option></select><ChevronDown size={16}/></div></label>
        <label><span>Проверяющий</span><input className="plain-input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></label>
        <label><span>Роль</span><div className="select-wrap"><select value={role} onChange={(e) => setRole(e.target.value as "expert" | "controller")}><option value="expert">Эксперт</option><option value="controller">Контролёр</option></select><ChevronDown size={16}/></div></label>
        <button className="refresh" onClick={() => void loadCases()}><RefreshCw size={17}/> Обновить</button>
      </section>

      {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть" onClick={() => setNotice("")}><X size={15}/></button></div>}

      <div className="workspace">
        <section className="list-pane">
          <div className="section-title"><div><h2>{kind === "estimate" ? "Найденные совпадения" : "Конфликты реквизитов"}</h2><p>{filtered.length} результатов для экспертной проверки</p></div><span className="api-live"><i/> API подключён</span></div>
          <div className="table-wrap">
            <table><thead><tr><th>Сопоставление</th><th>{kind === "estimate" ? "Наименование" : "Контрагент"}</th><th>Расхождение</th><th>Уровень</th><th>Статус</th></tr></thead>
              <tbody>{filtered.map((item) => <tr key={item.id} className={item.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}>
                <td><strong>{item.subtitle.split(" · ")[0]}</strong></td><td>{item.title}</td><td>{item.difference}</td><td><span className={`severity ${item.severity}`}>{severityLabel[item.severity]}</span></td><td><span className={`status status-${item.review.status}`}>{statusLabel[item.review.status]}</span></td>
              </tr>)}</tbody></table>
            {!loading && !filtered.length && <div className="empty">По вашему фильтру ничего не найдено</div>}
          </div>
        </section>

        <aside className="detail-pane">
          <div className="detail-heading"><div><h2>Детали выбранного совпадения</h2><p>{selected?.subtitle}</p></div><span>{selected ? `${Math.max(1, filtered.findIndex((i) => i.id === selected.id) + 1)} из ${filtered.length}` : "—"}</span></div>
          {selected ? <>
            <div className="records"><RecordPanel title="Запись A · текущая" tone="blue" values={selected.left}/><RecordPanel title="Запись B · требует проверки" tone="red" values={selected.right}/></div>
            <section className="explanation"><h3>Объяснение</h3><p>{selected.explanation}</p></section>
            {kind === "requisite" && <section className="registry"><div><Database size={19}/><div><strong>Проверка БИН</strong><span>{registry || "Сейчас используется безопасный синтетический источник"}</span></div></div><button onClick={() => void checkRegistry()}>Проверить</button></section>}
            <section className="decision">
              <div className="decision-head"><div><h3>Решение эксперта</h3><p>{selected.severity === "critical" ? "Для критичного случая нужны две роли" : "Решение записывается в D1"}</p></div><span className={`status status-${selected.review.status}`}>{statusLabel[selected.review.status]}</span></div>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Добавьте комментарий к решению"/>
              <div className="decision-actions"><button className="accept" disabled={loading} onClick={() => void decide("accepted")}><Check size={17}/> Подтвердить</button><button className="reject" disabled={loading} onClick={() => void decide("rejected")}><X size={17}/> Отклонить</button></div>
              {!!selected.review.history.length && <details><summary>История согласования · {selected.review.history.length}</summary><div className="history">{selected.review.history.map((row, index) => <p key={index}><strong>{row.reviewer}</strong> · {row.role === "expert" ? "эксперт" : "контролёр"} · {row.action === "accepted" ? "подтверждено" : "отклонено"}<span>{row.created_at}</span></p>)}</div></details>}
            </section>
          </> : <div className="empty">Выберите запись</div>}
        </aside>
      </div>
    </main>
    <footer><span>СверкаСмет · пилотная система</span><span>Официальные реестры подключаются только после согласования доступа</span></footer>
  </div>;
}

export default App;
