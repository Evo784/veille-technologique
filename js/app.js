import { kpiStatus, computeKpis } from "./kpi.js";

const THEMES = {
  "dotnet-csharp": "C# / .NET", "angular": "Angular", "github-copilot": "GitHub / Copilot",
  "agents-ia": "Agents IA", "ia-locale": "IA locale", "outils-dev": "Outils de dev", "architecture-cloud": "Architecture / cloud",
};
const STATUS = { ok: "atteint", warn: "à surveiller", alert: "alerte", na: "pas de données" };
const VIEWS = ["veille", "objectifs", "methode", "prospective", "criticite"];

const $ = (id) => document.getElementById(id);
const themeName = (t) => THEMES[t] ?? t ?? "Autre";
const toDate = (d) => new Date(d + "T00:00:00");
const longDate = (d) => (d ? toDate(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "inconnue");
const shortDate = (d) => (d ? toDate(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }).replace(".", "") : "sans date");
const fr = (v) => String(v).replace(".", ",");
const fmt = (v, unit) => {
  if (v === null || v === undefined) return "–";
  if (unit === "%") return `${fr(Math.round(v))} %`;
  if (unit === "/5") return `${fr(Math.round(v * 10) / 10)}/5`;
  return fr(v);
};
const safeUrl = (u) => (/^https?:\/\//.test(u ?? "") ? u : "#");

// Le contenu des JSON passe toujours par textContent.
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const link = (href, text) => el("a", { href: safeUrl(href), target: "_blank", rel: "noopener noreferrer", text });

// ---------- navigation ----------
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "veille";
  document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll("nav a").forEach((a) => (a.hash === `#${v}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();

async function getJson(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
  return r.json();
}

async function init() {
  let cur, objectives, sources, kpiDefs, scenarios;
  try {
    [cur, objectives, sources, kpiDefs, scenarios] = await Promise.all(
      ["current", "objectives", "sources", "kpis", "scenarios"].map((f) => getJson(`data/${f}.json`)));
  } catch (e) {
    const box = $("load-error");
    box.hidden = false;
    box.textContent = `Impossible de lire les données (${e.message}). En local, lancer un serveur : npx serve .`;
    return;
  }
  const srcById = new Map(sources.sources.map((s) => [s.id, s]));
  const items = cur.items ?? [];
  const kpis = cur.kpis ?? computeKpis(items.filter((i) => i.session === cur.lastSession), sources.sources);
  const defs = new Map(kpiDefs.kpis.map((d) => [d.id, d]));

  renderVeille(cur, kpis, defs, items, srcById);
  renderObjectives(objectives, kpiDefs.kpis, kpis);
  renderMethode(sources.sources, cur.sessions ?? []);
  renderScenarios(scenarios);
  $("foot").replaceChildren(
    el("span", { text: "Edwyn Houillier · veille technologique, projet de cours" }),
    el("span", { text: `Données mises à jour le ${cur.generatedAt ? new Date(cur.generatedAt).toLocaleDateString("fr-FR") : "?"}` }));
}

// ---------- veille ----------
function renderVeille(cur, kpis, defs, items, srcById) {
  $("session-line").textContent = cur.lastSession
    ? `Session du ${longDate(cur.lastSession)} · ${kpis.volume} infos retenues${cur.examined ? ` sur ${cur.examined} lues` : ""} · prochaine vers le ${longDate(cur.nextSession)}`
    : "Aucune session pour l'instant.";

  const figure = (id, label) => {
    const d = defs.get(id); const v = kpis[id]; const st = kpiStatus(d, v);
    const unit = d.unit === "%" ? " %" : d.unit === "/5" ? "/5" : "";
    const shown = v === null || v === undefined ? "–" : d.unit === "%" ? fr(Math.round(v)) : d.unit === "/5" ? fr(Math.round(v * 10) / 10) : fr(v);
    return el("div", { class: st === "ok" || st === "na" ? "" : "below" },
      el("dt", { text: label }),
      el("dd", {}, shown, v !== null && v !== undefined && unit ? el("small", { text: unit }) : null),
      el("span", { class: "target", text: `objectif ${d.unit === "nb" ? "≥ " + d.target : fmt(d.target, d.unit)}` }));
  };
  $("figures").replaceChildren(
    figure("relevance_rate", "Infos pertinentes"),
    figure("quality_avg", "Qualité moyenne"),
    figure("crosscheck_rate", "Recoupées"),
    figure("weak_signals", "Signaux faibles"));

  const adj = cur.adjustments ?? {};
  const changes = [...(adj.sources ?? []), ...(adj.keywords ?? [])].slice(0, 5);
  $("takeaway").replaceChildren(
    el("div", {}, el("h3", { text: "Bilan de la session" }), el("p", { text: cur.analysis?.conclusion ?? "Pas encore de bilan." }),
      el("p", { class: "spread", text: "Par thème : " + Object.entries(cur.byTheme ?? {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${themeName(t)} ${n}`).join(" · ") }),
      el("p", { class: "spread", text: "Par horizon : " + ["H1", "H2", "H3"].map((h) => `${h} ${cur.byHorizon?.[h] ?? 0}`).join(" · ") })),
    changes.length ? el("div", {}, el("h3", { text: "Ce que j'ajuste" }), el("ul", {}, changes.map((t) => el("li", { text: t })))) : null);

  const themes = [...new Set(items.map((i) => i.theme))];
  $("f-theme").append(...themes.map((t) => el("option", { value: t, text: themeName(t) })));
  const q = $("q"), fh = $("f-horizon"), ft = $("f-theme"), fw = $("f-weak");
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const list = items.filter((i) =>
      (!fh.value || (i.horizon ?? []).includes(fh.value)) &&
      (!ft.value || i.theme === ft.value) &&
      (!fw.checked || i.weakSignal === true) &&
      (!s || [i.title, i.summary, i.action].some((x) => (x ?? "").toLowerCase().includes(s))));
    $("entries").replaceChildren(...(list.length
      ? list.map((i) => entry(i, srcById))
      : [el("li", { class: "empty", text: items.length ? "Rien ne correspond." : "Aucune information collectée pour l'instant." })]));
  };
  [q, fh, ft, fw].forEach((c) => c.addEventListener("input", draw));
  draw();
}

function entry(i, srcById) {
  const src = srcById.get(i.source);
  const sub = [src?.name ?? i.source, themeName(i.theme)].join(" · ");
  const checks = (i.crossCheckWith ?? []);
  return el("li", { class: "entry" }, el("details", {},
    el("summary", {},
      el("span", { class: "date", text: shortDate(i.publishedAt) }),
      el("span", {},
        el("span", { class: "title", text: i.title }),
        el("span", { class: "sub" }, sub, i.weakSignal ? el("span", { class: "weak", text: " · signal faible" }) : null,
          i.review === "auto" ? " · notation auto" : null)),
      el("span", { class: "hz", text: (i.horizon ?? []).join(" ") })),
    el("div", { class: "body" },
      el("p", { text: i.summary ?? "Pas de résumé." }),
      i.action ? el("p", { class: "todo", text: i.action }) : null,
      el("p", { class: "check-note" },
        i.crossChecked ? "Recoupé avec " : "Pas recoupé. ",
        ...checks.flatMap((u, k) => [k ? ", " : "", link(u, new URL(u).hostname + new URL(u).pathname.replace(/\/$/, "").slice(0, 40))]),
        i.crossChecked ? ". " : "",
        i.notes ?? ""),
      el("p", {}, link(i.url, "Lire la source originale →")),
      el("div", { class: "facts" },
        el("span", { text: `pertinence ${i.relevance ?? "–"}` }), el("span", { text: `crédibilité ${i.credibility ?? "–"}` }),
        el("span", { text: `nouveauté ${i.novelty ?? "–"}` }), el("span", { text: `efficacité ${i.efficacy ?? "–"}` }),
        el("span", { text: `qualité ${i.quality != null ? fr(i.quality) : "–"}/5` }), el("span", { text: `utilité ${i.utility ?? "–"}/5` }),
        el("span", { text: `publié ${longDate(i.publishedAt)}` }), el("span", { text: `collecté ${longDate(i.collectedAt)}` }),
        el("span", { text: (i.lang ?? "?").toUpperCase() })))));
}

// ---------- objectifs & KPIs ----------
function renderObjectives(o, defs, kpis) {
  $("smart").textContent = o.smart ?? "";
  $("horizons").replaceChildren(...o.horizons.map((h) => el("div", { class: "h" },
    el("div", { class: "h-id", text: h.id }),
    el("div", { class: "h-when", text: `${h.label.toLowerCase()} · ${h.timeframe}` }),
    el("p", { text: h.objective }),
    el("p", {}, el("span", { class: "label", text: "Rythme" }), h.frequency),
    el("p", {}, el("span", { class: "label", text: "Réussi si" }), h.success))));

  const rows = defs.map((d) => {
    const v = kpis[d.id]; const st = kpiStatus(d, v);
    const target = d.direction === "range" ? `${d.target} à ${d.targetMax}` : `≥ ${fmt(d.target, d.unit)}`;
    const alert = d.direction === "range" ? `> ${d.alert}` : `< ${fmt(d.alert, d.unit)}`;
    return el("tr", {},
      el("td", {}, el("span", { class: "def", text: d.family }), el("b", { text: d.name }),
        el("span", { class: "def", text: d.definition }), el("span", { class: "def", text: `Si alerte : ${d.action}` })),
      el("td", {}, el("span", { class: "val", text: fmt(v, d.unit) })),
      el("td", { class: "mono", text: target }),
      el("td", { class: "mono", text: alert }),
      el("td", {}, el("span", { class: `status ${st}`, text: STATUS[st] })));
  });
  $("kpis-table").replaceChildren(
    el("thead", {}, el("tr", {}, ["Indicateur", "Valeur", "Cible", "Alerte", "État"].map((h) => el("th", { text: h })))),
    el("tbody", {}, rows));
  wrapScroll($("kpis-table"));
}

// ---------- sources & méthode ----------
function renderMethode(list, sessions) {
  $("sources-table").replaceChildren(
    el("thead", {}, el("tr", {}, ["Source", "Type", "Langue", "Autorité", "Rythme", "Collecte"].map((h) => el("th", { text: h })))),
    el("tbody", {}, list.map((s) => el("tr", {},
      el("td", {}, link(s.url, s.name), s.note ? el("span", { class: "src-note", text: s.note }) : null),
      el("td", { text: s.type }), el("td", { class: "mono", text: s.lang.toUpperCase() }),
      el("td", { class: "mono", text: `${s.authority}/5` }), el("td", { text: s.frequency }), el("td", { text: s.collection })))));
  wrapScroll($("sources-table"));

  $("sessions-table").replaceChildren(
    el("thead", {}, el("tr", {}, ["Date", "Lues", "Retenues", "Pertinentes", "Qualité", "Recoupées", "Signaux faibles"].map((h) => el("th", { text: h })))),
    el("tbody", {}, [...sessions].reverse().map((s) => el("tr", {},
      el("td", { text: longDate(s.date) }), el("td", { text: s.examined ?? "–" }), el("td", { text: s.count }),
      el("td", { text: fmt(s.kpis?.relevance_rate, "%") }), el("td", { text: fmt(s.kpis?.quality_avg, "/5") }),
      el("td", { text: fmt(s.kpis?.crosscheck_rate, "%") }), el("td", { text: s.kpis?.weak_signals ?? "–" })))));
  wrapScroll($("sessions-table"));
}

function wrapScroll(table) {
  if (table.parentElement.classList.contains("table-scroll")) return;
  const w = el("div", { class: "table-scroll" });
  table.replaceWith(w); w.append(table);
}

// ---------- prospective ----------
function renderScenarios(sc) {
  $("scen-note").textContent = `Ce ne sont pas des prédictions : ce sont trois futurs possibles que je confronte aux signaux de chaque session. Dernière révision le ${longDate(sc.updated)}.`;
  const list = (t, arr) => [el("h4", { text: t }), el("ul", {}, (arr ?? []).map((x) => el("li", { text: x })))];
  $("scenarios").replaceChildren(...sc.scenarios.map((s, k) => el("article", { class: "scen" },
    el("span", { class: "num", text: `Scénario ${k + 1}` }),
    el("h3", { text: s.title }),
    el("p", { text: s.summary }),
    el("h4", { text: "Hypothèse" }), el("p", { text: s.hypothesis }),
    ...list("Ce que j'observe", s.signals), ...list("Ce que je ne sais pas", s.unknowns),
    el("h4", { text: "Plausibilité" }), el("p", { text: s.plausibility }))));
}

init();
