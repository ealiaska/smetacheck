"""Streamlit UI for estimate duplicate review and requisite conflict review."""

from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.embeddings import active_backend, backend_metadata
from pipeline.explain import explain_pair
from pipeline.false_positive_filter import find_candidate_pairs
from pipeline.ingest import SchemaError, read_estimate, read_requisites
from pipeline.normalize import add_normalized_columns
from pipeline.registry_providers import (
    ConfiguredHttpRegistryProvider,
    DisabledRegistryProvider,
    RegistryUnavailable,
    SyntheticRegistryProvider,
)
from pipeline.requisites_check import find_requisite_conflicts
from pipeline.storage import DecisionConflict, DecisionStore

FLAG_LABELS = {"semantic": "Семантика", "numeric": "Числа", "both": "Семантика + числа"}
FIELD_LABELS = {
    "bin": "БИН", "legal_address": "юр. адрес", "bank_name": "банк",
    "bik": "БИК", "account_number": "ИИК", "entity_name": "наименование",
}
ROLE_LABELS = {"expert": "Эксперт", "controller": "Финансовый контролёр"}
STORE = DecisionStore()

st.set_page_config(page_title="СверкаСмет", page_icon="◎", layout="wide")

st.markdown(
    """
    <style>
    :root {
        --navy: #102f5f; --slate: #60708c; --line: #dce5ef;
        --cyan: #00a7b7; --critical: #d9475c; --amber: #d88a10;
    }
    .stApp { background: #ffffff; color: var(--navy); }
    .block-container { padding-top: 1.45rem; padding-bottom: 2.5rem; max-width: 1540px; }
    h1, h2, h3 { color: var(--navy); letter-spacing: -0.025em; }
    h1 { font-size: 2rem !important; margin: 0 !important; }
    div[data-baseweb="tab-list"] { gap: 1.25rem; border-bottom: 1px solid var(--line); }
    button[data-baseweb="tab"] { font-size: .96rem; font-weight: 650; padding: .7rem .2rem; }
    div[data-baseweb="tab-highlight"] { background: var(--cyan); height: 3px; }
    div[data-testid="stVerticalBlockBorderWrapper"] { border-color: var(--line); border-radius: 8px; }
    div[data-testid="stMetricValue"] { font-size: 1.05rem; }
    .record-title { font-weight: 700; color: var(--navy); margin-bottom: .35rem; }
    .trace { color: var(--slate); font-size: .82rem; }
    .explain { background: #f5f8fc; border-left: 4px solid var(--cyan); padding: .85rem 1rem; border-radius: 5px; }
    .critical-note { background: #fff2f3; border-left-color: var(--critical); }
    .stButton button { font-weight: 650; border-radius: 6px; }
    </style>
    """,
    unsafe_allow_html=True,
)


def init_state() -> None:
    st.session_state.setdefault("reviewer_name", "demo-expert")
    st.session_state.setdefault("reviewer_role", "expert")
    st.session_state.setdefault("decision_notice", None)
    st.session_state.setdefault("registry_results", {})


def set_decision(
    track: str,
    item_id: str,
    value: str,
    severity: str | None,
    expected_version: int,
    comment_key: str,
    evidence: dict,
) -> None:
    try:
        STORE.record(
            track=track,
            item_id=item_id,
            decision=value,
            role=st.session_state["reviewer_role"],
            actor=st.session_state["reviewer_name"],
            expected_version=expected_version,
            severity=severity,
            comment=st.session_state.get(comment_key, ""),
            evidence=evidence,
            model_metadata=backend_metadata() if track == "estimate" else {},
        )
        st.session_state["decision_notice"] = "Решение сохранено в журнале аудита."
    except (DecisionConflict, ValueError) as exc:
        st.session_state["decision_notice"] = str(exc)


def decision_label(track: str, item_id: str, severity: str | None = None) -> str:
    return STORE.state(track, item_id, severity).label


def header() -> None:
    with st.sidebar:
        st.subheader("Контекст проверки")
        st.text_input("Пользователь", key="reviewer_name")
        st.selectbox(
            "Роль",
            list(ROLE_LABELS),
            format_func=ROLE_LABELS.get,
            key="reviewer_role",
        )
        st.caption("Решения сохраняются в SQLite и попадают в неизменяемый журнал аудита.")
    left, right = st.columns([4, 1])
    with left:
        st.title("СверкаСмет")
        st.caption("Поиск похожих позиций и конфликтов реквизитов")
    with right:
        st.markdown("<p style='text-align:right;color:#60708c;margin-top:.8rem'>Решение всегда принимает эксперт</p>", unsafe_allow_html=True)


def estimate_data() -> pd.DataFrame:
    uploads = st.file_uploader(
        "CSV/XLSX сметы (один или два файла)",
        type=["csv", "xlsx"],
        accept_multiple_files=True,
        key="estimate_uploads",
    )
    if len(uploads) > 2:
        st.warning("Используются первые два файла.")
        uploads = uploads[:2]
    sources = uploads or [ROOT / "data" / "est_01.csv", ROOT / "data" / "est_02.csv"]
    frames = [read_estimate(source, getattr(source, "name", None)) for source in sources]
    return pd.concat(frames, ignore_index=True)


def record_panel(title: str, row: pd.Series) -> None:
    with st.container(border=True):
        st.markdown(f"<div class='record-title'>{title}</div>", unsafe_allow_html=True)
        st.markdown(
            f"<div class='trace'>{row['document_id']} · позиция {row['position_id']} · {row['page_or_sheet']}</div>",
            unsafe_allow_html=True,
        )
        st.write(row["work_description"])
        a, b, c = st.columns(3)
        a.metric("Ед. изм.", row["unit"])
        b.metric("Объём", f"{float(row['quantity']):,.2f}".rstrip("0").rstrip("."))
        c.metric("Цена", f"{float(row['unit_price']):,.0f} ₸")
        st.caption(f"Норматив: {row['norm_ref']}")


def render_estimates() -> None:
    st.subheader("Позиции работ")
    try:
        estimates = estimate_data()
    except SchemaError as exc:
        st.error(str(exc))
        return
    with st.spinner("Семантическое сравнение выполняется локально…"):
        pairs = find_candidate_pairs(estimates, include_excluded=True)
    if pairs.empty:
        st.info("Похожих пар при текущих порогах не найдено.")
        return

    c1, c2, c3 = st.columns([1, 1, 2])
    status_choice = c1.selectbox("Результат фильтра", ["Предложения", "Отфильтрованные", "Все"])
    flag_options = sorted(pairs["flag_type"].unique().tolist())
    flag_choice = c2.multiselect("Тип флага", flag_options, default=flag_options, format_func=FLAG_LABELS.get)
    documents = sorted(set(pairs["left_document_id"]) | set(pairs["right_document_id"]))
    document_choice = c3.multiselect("Документ", documents, default=documents)

    visible = pairs[pairs["flag_type"].isin(flag_choice)]
    visible = visible[
        visible["left_document_id"].isin(document_choice) | visible["right_document_id"].isin(document_choice)
    ]
    if status_choice != "Все":
        visible = visible[visible["status"] == ("proposed" if status_choice == "Предложения" else "excluded")]
    if visible.empty:
        st.info("Нет результатов с выбранными фильтрами.")
        return

    table = visible.copy()
    table["score"] = table["embedding_score"].map(lambda value: f"{value:.2f}")
    table["flag_type"] = table["flag_type"].map(FLAG_LABELS)
    table["решение"] = table["pair_id"].map(lambda item: decision_label("estimate", item))
    st.dataframe(
        table[["pair_id", "score", "flag_type", "left_description", "right_description", "решение"]].rename(
            columns={"pair_id": "Пара", "flag_type": "Флаг", "left_description": "Позиция A", "right_description": "Позиция B"}
        ),
        use_container_width=True,
        hide_index=True,
        height=300,
    )

    pair_id = st.selectbox("Детали выбранного совпадения", visible["pair_id"].tolist())
    pair = visible[visible["pair_id"] == pair_id].iloc[0]
    normalized = add_normalized_columns(estimates).reset_index(drop=True)
    left = normalized.iloc[int(pair["left_index"])]
    right = normalized.iloc[int(pair["right_index"])]
    left_col, right_col = st.columns(2)
    with left_col:
        record_panel("Запись A", left)
    with right_col:
        record_panel("Запись B", right)
    explanation = explain_pair(pair, left, right)
    st.markdown(f"<div class='explain'><strong>Объяснение</strong><br>{explanation}</div>", unsafe_allow_html=True)
    st.caption(f"Локальный семантический backend: {active_backend()}")
    review_state = STORE.state("estimate", pair_id)
    comment_key = f"est_comment_{pair_id}"
    st.text_input("Комментарий к решению", key=comment_key, placeholder="Необязательно")
    yes, no, state = st.columns([1.5, 1.5, 3])
    evidence = {
        "left_document_id": pair["left_document_id"],
        "right_document_id": pair["right_document_id"],
        "embedding_score": float(pair["embedding_score"]),
        "flag_type": pair["flag_type"],
    }
    yes.button(
        "✓ Подтвердить", key=f"est_yes_{pair_id}", on_click=set_decision,
        args=("estimate", pair_id, "accepted", None, review_state.version, comment_key, evidence), type="primary",
    )
    no.button(
        "⊘ Отклонить", key=f"est_no_{pair_id}", on_click=set_decision,
        args=("estimate", pair_id, "rejected", None, review_state.version, comment_key, evidence),
    )
    state.info(review_state.label)
    if st.session_state.get("decision_notice"):
        st.caption(st.session_state.pop("decision_notice"))
    history = STORE.history("estimate", pair_id)
    if history:
        with st.expander(f"История решений · {len(history)}"):
            st.dataframe(pd.DataFrame(history), use_container_width=True, hide_index=True)


def requisite_panel(title: str, row: pd.Series, critical: bool = False) -> None:
    with st.container(border=True):
        color = "#d9475c" if critical else "#102f5f"
        st.markdown(f"<div class='record-title' style='color:{color}'>{title}</div>", unsafe_allow_html=True)
        st.markdown(f"<div class='trace'>{row['document_id']} · {row['page_or_sheet']}</div>", unsafe_allow_html=True)
        for label, field in (
            ("Контрагент", "entity_name"), ("БИН", "bin"), ("Адрес", "legal_address"),
            ("Банк", "bank_name"), ("БИК", "bik"), ("ИИК", "account_number"),
        ):
            st.markdown(f"**{label}:** {row[field]}")


def render_requisites() -> None:
    st.subheader("Реквизиты контрагентов")
    upload = st.file_uploader("CSV/XLSX реестра реквизитов", type=["csv", "xlsx"], key="requisite_upload")
    source = upload or ROOT / "data" / "counterparties.csv"
    try:
        requisites = read_requisites(source, getattr(source, "name", None))
    except SchemaError as exc:
        st.error(str(exc))
        return
    flags = find_requisite_conflicts(requisites, include_info=True)
    if flags.empty:
        st.success("Конфликтов реквизитов не найдено.")
        return

    severity_labels = {"critical": "Критично", "high": "Высокий", "medium": "Средний", "info": "Инфо"}
    c1, c2 = st.columns([1, 2])
    selected_severity = c1.multiselect("Критичность", list(severity_labels), default=list(severity_labels), format_func=severity_labels.get)
    documents = sorted(set(flags["left_document_id"]) | set(flags["right_document_id"]))
    selected_docs = c2.multiselect("Документ", documents, default=documents)
    visible = flags[flags["severity"].isin(selected_severity)]
    visible = visible[
        visible["left_document_id"].isin(selected_docs) | visible["right_document_id"].isin(selected_docs)
    ]
    if visible.empty:
        st.info("Нет результатов с выбранными фильтрами.")
        return

    table = visible.copy()
    table["Критичность"] = table["severity"].map(severity_labels)
    table["Расхождения"] = table["changed_fields"].map(
        lambda fields: ", ".join(FIELD_LABELS.get(field, field) for field in fields)
    )
    table["Решение"] = table.apply(
        lambda row: decision_label("requisite", row["flag_id"], row["severity"]), axis=1
    )
    st.dataframe(
        table[["flag_id", "entity_name", "Критичность", "Расхождения", "Решение"]].rename(
            columns={"flag_id": "Сопоставление", "entity_name": "Контрагент"}
        ).style.map(
            lambda value: "background-color:#fff0f2;color:#b51e35;font-weight:700" if value == "Критично" else "",
            subset=["Критичность"],
        ),
        use_container_width=True,
        hide_index=True,
        height=300,
    )

    flag_id = st.selectbox("Детали выбранного конфликта", visible["flag_id"].tolist())
    flag = visible[visible["flag_id"] == flag_id].iloc[0]
    left = requisites.iloc[int(flag["left_index"])]
    right = requisites.iloc[int(flag["right_index"])]
    left_col, right_col = st.columns(2)
    with left_col:
        requisite_panel("Запись A", left)
    with right_col:
        requisite_panel("Запись B · есть конфликт", right, flag["severity"] == "critical")
    class_name = "explain critical-note" if flag["severity"] == "critical" else "explain"
    st.markdown(f"<div class='{class_name}'><strong>Объяснение</strong><br>{flag['explanation']}</div>", unsafe_allow_html=True)

    gateway = ConfiguredHttpRegistryProvider()
    provider_names = ["Отключено", "Синтетический mock"]
    if gateway.configured:
        provider_names.append("Корпоративный шлюз реестров")
    provider_name = st.selectbox("Источник внешней сверки", provider_names, key=f"provider_{flag_id}")
    if st.button("Проверить БИН", key=f"lookup_{flag_id}"):
        provider = {
            "Отключено": DisabledRegistryProvider(),
            "Синтетический mock": SyntheticRegistryProvider(requisites),
            "Корпоративный шлюз реестров": gateway,
        }[provider_name]
        try:
            result = provider.lookup(str(left["bin"]))
            st.session_state["registry_results"][flag_id] = result.to_dict() if result else None
        except RegistryUnavailable as exc:
            st.session_state["registry_results"][flag_id] = {"error": str(exc)}
    registry_result = st.session_state["registry_results"].get(flag_id)
    if registry_result:
        if "error" in registry_result:
            st.warning(registry_result["error"])
        else:
            st.success(f"Источник: {registry_result['source']} · БИН найден")
            st.json(registry_result, expanded=False)

    review_state = STORE.state("requisite", flag_id, str(flag["severity"]))
    comment_key = f"req_comment_{flag_id}"
    st.text_input("Комментарий к решению", key=comment_key, placeholder="Для critical рекомендуется указать основание")
    yes, no, state = st.columns([1.5, 1.5, 3])
    evidence = {
        "left_document_id": flag["left_document_id"],
        "right_document_id": flag["right_document_id"],
        "severity": flag["severity"],
        "changed_fields": list(flag["changed_fields"]),
    }
    yes.button(
        "✓ Подтвердить", key=f"req_yes_{flag_id}", on_click=set_decision,
        args=("requisite", flag_id, "accepted", str(flag["severity"]), review_state.version, comment_key, evidence), type="primary",
    )
    no.button(
        "⊘ Отклонить", key=f"req_no_{flag_id}", on_click=set_decision,
        args=("requisite", flag_id, "rejected", str(flag["severity"]), review_state.version, comment_key, evidence),
    )
    state.info(review_state.label)
    if st.session_state.get("decision_notice"):
        st.caption(st.session_state.pop("decision_notice"))
    history = STORE.history("requisite", flag_id)
    if history:
        with st.expander(f"История согласования · {len(history)}"):
            st.dataframe(pd.DataFrame(history), use_container_width=True, hide_index=True)


init_state()
header()
work_tab, requisite_tab = st.tabs(["Позиции работ", "Реквизиты контрагентов"])
with work_tab:
    render_estimates()
with requisite_tab:
    render_requisites()
