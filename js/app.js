import { kpiStatus, computeKpis } from "./kpi.js";

const THEMES = {
  "dotnet-csharp": "C# / .NET", "angular": "Angular", "github-copilot": "GitHub / Copilot",
  "agents-ia": "Agents IA", "ia-locale": "IA locale", "outils-dev": "Outils de dev", "architecture-cloud": "Architecture / cloud",
};
const STATUS_LABEL = { ok: "Atteint", warn: "À surveiller", alert: "Alerte", na: "n/d" };
const $ = (id) => document.getElementById(id);
const themeName = (t) => THEMES[t] ?? t ?? "Autre";
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "inconnue");
const num = (v, unit = "") => (v === null || v === undefined ? "n/d" : `${String(v).replace(".", ",")}${unit === "%" ? " %" : unit === "/5" ? "/5" : ""}`);

// Création de nœuds DOM : le contenu externe passe toujours par textContent.
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const badge = (text, cls) => el("span", { class: `badge ${cls}`, text });
const safeUrl = (u) => (/^https?:\/\//.test(u ?? "") ? u : "#");

async function getJson(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
  return r.json();
}

async function init() {
  let cur, objectives, sources, kpiDefs, scenarios;
  try {
    [cur, objectives, sources, kpiDefs, scenarios] = await Promise.all([
      getJson("data/current.json"), getJson("data/objectives.json"), getJson("data/sources.json"),
      getJson("data/kpis.json"), getJson("data/scenarios.json"),
    ]);
  } catch (e) {
    const box = $("load-error");
    box.hidden = false;
    box.textContent = `Données illisibles (${e.message}). En local, lancez un serveur (npx serve .) : l'ouverture directe du fichier ne permet pas de lire les JSON.`;
    return;
  }
  const srcById = new Map(sources.sources.map((s) => [s.id, s]));
  const items = cur.items ?? [];
  // KPIs : valeurs de la dernière session ; recalculées depuis les items si absentes (session vide ou ancienne).
  const lastItems = items.filter((i) => i.session === cur.lastSession);
  const kpis = cur.kpis ?? computeKpis(lastItems, sources.sources);

  renderDashboard(cur, kpis, kpiDefs.kpis);
  renderObjectives(objectives);
  renderJournal(items, srcById);
  renderSources(sources.sources);
  renderKpiTable(kpiDefs.kpis, kpis);
  renderScenarios(scenarios);
  $("foot").textContent = `Données générées le ${cur.generatedAt ? new Date(cur.generatedAt).toLocaleDateString("fr-FR") : "?"} · Projet scolaire : veille technologique.`;
}

function renderDashboard(cur, kpis, defs) {
  const dates = $("dates");
  dates.replaceChildren(
    el("span", {}, "Dernière veille : ", el("b", { text: fmtDate(cur.lastSession) })),
    el("span", {}, "Prochaine prévue : ", el("b", { text: `vers le ${fmtDate(cur.nextSession)}` })),
    el("span", {}, "Rythme : ", el("b", { text: `tous les ${cur.intervalDays ?? 14} jours` })),
  );
  const ids = ["volume", "relevance_rate", "quality_avg", "crosscheck_rate", "weak_signals", "actionable_rate"];
  const cards = ids.map((id) => {
    const d = defs.find((x) => x.id === id);
    const v = id === "volume" ? kpis.volume : kpis[id];
    const st = kpiStatus(d, v);
    const target = d.direction === "range" ? `Cible ${d.target} à ${d.targetMax}` : `Cible ≥ ${num(d.target, d.unit)}`;
    const label = id === "volume" ? "Informations conservées" : d.name;
    return el("div", { class: `kpi ${st}` },
      el("div", { class: "v", text: num(v, d.unit) }),
      el("div", { class: "l", text: label }),
      el("div", { class: "t", text: `${target} · ${STATUS_LABEL[st]}` }));
  });
  $("kpi-cards").replaceChildren(...cards);

  bars($("chart-theme"), cur.byTheme ?? {}, themeName);
  bars($("chart-horizon"), cur.byHorizon ?? {}, (k) => k);

  const a = cur.analysis, adj = cur.adjustments;
  const box = $("analysis");
  box.replaceChildren(el("h3", { text: "Analyse de la dernière session et ajustements" }));
  if (!a && !adj) { box.append(el("p", { class: "muted", text: "Aucune analyse disponible." })); return; }
  if (cur.examined) box.append(el("p", {}, el("b", { text: "Volume : " }), `${kpis.volume} informations conservées sur ${cur.examined} examinées.`));
  if (a?.conclusion) box.append(el("p", { text: a.conclusion }));
  const list = (title, arr) => arr?.length ? [el("p", {}, el("b", { text: title })), el("ul", {}, arr.map((t) => el("li", { text: t })))] : [];
  box.append(
    ...list("Sources utiles", a?.usefulSources), ...list("Sources trop bruyantes", a?.noisySources),
    ...list("Sujets sous-représentés", a?.underrepresented),
    ...list("Ajustements : sources", adj?.sources), ...list("Ajustements : mots-clés", adj?.keywords),
    ...list("Ajustements : horizons", adj?.horizons), ...list("Signaux faibles de la session", cur.weakSignals));

  const t = $("sessions-table");
  t.replaceChildren(
    el("tr", {}, ["Date", "Type", "Examinées", "Conservées", "Pertinence", "Qualité", "Cross-check", "Signaux faibles"].map((h) => el("th", { text: h }))),
    ...[...(cur.sessions ?? [])].reverse().map((s) => el("tr", {},
      el("td", { text: fmtDate(s.date) }), el("td", { text: s.type ?? "n/d" }), el("td", { text: s.examined ?? "n/d" }),
      el("td", { text: s.count }), el("td", { text: num(s.kpis?.relevance_rate, "%") }), el("td", { text: num(s.kpis?.quality_avg, "/5") }),
      el("td", { text: num(s.kpis?.crosscheck_rate, "%") }), el("td", { text: s.kpis?.weak_signals ?? "n/d" }))));
}

function bars(root, dist, label) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { root.replaceChildren(el("p", { class: "muted", text: "Aucune donnée." })); return; }
  const max = Math.max(...entries.map(([, n]) => n));
  root.replaceChildren(...entries.map(([k, n]) => el("div", { class: "bar-row" },
    el("span", { text: label(k) }), el("div", { class: "bar" }, el("i", { style: `width:${(n / max) * 100}%` })), el("b", { text: n }))));
}

function renderObjectives(o) {
  $("smart").textContent = o.smart ?? "";
  $("horizons").replaceChildren(...o.horizons.map((h) => el("div", { class: "card" },
    el("h3", {}, badge(h.id, h.id), ` ${h.label}`),
    el("p", {}, el("b", { text: "Temporalité : " }), h.timeframe),
    el("p", {}, el("b", { text: "Objectif : " }), h.objective),
    el("p", {}, el("b", { text: "Fréquence : " }), h.frequency),
    el("p", {}, el("b", { text: "Critère de réussite : " }), h.success))));
}

function renderJournal(items, srcById) {
  const themes = [...new Set(items.map((i) => i.theme))];
  $("f-theme").append(...themes.map((t) => el("option", { value: t, text: themeName(t) })));
  const ctl = { q: $("q"), h: $("f-horizon"), t: $("f-theme"), f: $("f-flag") };

  const draw = () => {
    const q = ctl.q.value.trim().toLowerCase();
    const list = items.filter((i) =>
      (!ctl.h.value || (i.horizon ?? []).includes(ctl.h.value)) &&
      (!ctl.t.value || i.theme === ctl.t.value) &&
      (!ctl.f.value || (ctl.f.value === "weak" ? i.weakSignal === true : ctl.f.value === "cross" ? i.crossChecked === true : i.crossChecked !== true)) &&
      (!q || [i.title, i.summary, i.action, i.notes].some((s) => (s ?? "").toLowerCase().includes(q))));
    $("count").textContent = `${list.length} information${list.length > 1 ? "s" : ""} sur ${items.length}`;
    $("entries").replaceChildren(...(list.length ? list.map((i) => entry(i, srcById)) : [el("div", { class: "empty", text: items.length ? "Aucun résultat pour ces filtres." : "Aucune information collectée pour le moment." })]));
  };
  Object.values(ctl).forEach((c) => c.addEventListener("input", draw));
  draw();
}

function entry(i, srcById) {
  const s = srcById.get(i.source);
  const scores = [["P", i.relevance], ["C", i.credibility], ["N", i.novelty], ["E", i.efficacy]].map(([k, v]) => `${k} ${v ?? "n/d"}`).join(" · ");
  return el("article", { class: "entry" },
    el("div", { class: "badges" },
      ...(i.horizon ?? []).map((h) => badge(h, h)), badge(themeName(i.theme), "plain"),
      i.weakSignal ? badge("Signal faible", "weak") : null,
      i.crossChecked ? badge("Recoupé", "ok") : badge("Non recoupé", "na"),
      i.review === "auto" ? badge("Notation auto", "warn") : null),
    el("h3", {}, el("a", { href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer", text: i.title })),
    el("p", { text: i.summary ?? "Résumé non disponible." }),
    i.action ? el("p", { class: "action" }, el("b", { text: "Action possible : " }), i.action) : null,
    el("div", { class: "meta" },
      el("span", { text: `Source : ${s?.name ?? i.source}${s ? ` (autorité ${s.authority}/5)` : ""}` }),
      el("span", { text: `Publié : ${fmtDate(i.publishedAt)}` }), el("span", { text: `Collecté : ${fmtDate(i.collectedAt)}` }),
      el("span", { text: `Langue : ${(i.lang ?? "?").toUpperCase()}` }),
      el("span", { text: `Qualité ${num(i.quality)}/5 (${scores})` }), el("span", { text: `Utilité ${i.utility ?? "n/d"}/5` })),
    (i.notes || i.crossCheckWith?.length) ? el("details", {}, el("summary", { text: "Vérification" }),
      i.notes ? el("p", { text: i.notes }) : null,
      ...(i.crossCheckWith ?? []).map((u) => el("div", {}, "Recoupé avec : ", el("a", { href: safeUrl(u), target: "_blank", rel: "noopener noreferrer", text: u })))) : null);
}

function renderSources(list) {
  const rows = list.map((s) => el("tr", {},
    el("td", {}, el("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer", text: s.name }), s.note ? el("div", { class: "muted", text: s.note }) : null),
    el("td", { text: s.type }), el("td", { text: s.lang.toUpperCase() }), el("td", { text: `${s.authority}/5` }),
    el("td", { text: s.frequency }), el("td", { text: s.collection }), el("td", {}, badge(s.status ?? "n/d", s.status === "bruyante" ? "warn" : s.status === "utile" ? "ok" : "na"))));
  $("sources-table").replaceChildren(
    el("tr", {}, ["Source", "Type", "Langue", "Autorité", "Fréquence", "Collecte", "Bilan"].map((h) => el("th", { text: h }))), ...rows);
}

function renderKpiTable(defs, kpis) {
  const rows = defs.map((d) => {
    const v = kpis[d.id]; const st = kpiStatus(d, v);
    const target = d.direction === "range" ? `${d.target} à ${d.targetMax}` : `≥ ${num(d.target, d.unit)}`;
    const alert = d.direction === "range" ? `> ${d.alert}` : `< ${num(d.alert, d.unit)}`;
    return el("tr", {},
      el("td", {}, el("b", { text: d.name })), el("td", { text: d.family }),
      el("td", {}, el("b", { text: num(v, d.unit) }), " ", badge(STATUS_LABEL[st], st)),
      el("td", { text: target }), el("td", { text: alert }), el("td", { text: d.definition }), el("td", { text: d.action }));
  });
  $("kpis-table").replaceChildren(
    el("tr", {}, ["KPI", "Famille", "Valeur", "Cible", "Seuil d'alerte", "Définition", "Action corrective"].map((h) => el("th", { text: h }))), ...rows);
}

function renderScenarios(sc) {
  $("scen-note").textContent = `${sc.note} Dernière révision : ${fmtDate(sc.updated)}.`;
  const list = (t, arr) => [el("h4", { text: t }), el("ul", {}, (arr ?? []).map((x) => el("li", { text: x })))];
  $("scenarios").replaceChildren(...sc.scenarios.map((s) => el("div", { class: "card scen" },
    el("h3", {}, el("span", { text: `${s.id} · ${s.title}` })),
    el("p", { text: s.summary }),
    el("h4", { text: "Hypothèse" }), el("p", { text: s.hypothesis }),
    ...list("Signaux observés", s.signals), ...list("Inconnues", s.unknowns),
    el("h4", { text: "Plausibilité" }), el("p", { text: s.plausibility }))));
}

init();
