import { kpiStatus, computeKpis } from "./kpi.js";

const STATUS = { ok: "atteint", warn: "à surveiller", alert: "alerte", na: "–" };

const $ = (id) => document.getElementById(id);
const toDate = (d) => new Date(d + "T00:00:00");
const longDate = (d) => (d ? toDate(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "date inconnue");
const shortDate = (d) => (d ? toDate(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "sans date");
const fr = (v) => String(v).replace(".", ",");
const fmt = (v, unit) => {
  if (v === null || v === undefined) return "–";
  if (unit === "%") return `${Math.round(v)} %`;
  if (unit === "/5") return `${fr(Math.round(v * 10) / 10)}/5`;
  return fr(v);
};
const safeUrl = (u) => (/^https?:\/\//.test(u ?? "") ? u : "#");

// Le contenu des JSON passe toujours par textContent.
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
const link = (href, text) => el("a", { href: safeUrl(href), target: "_blank", rel: "noopener noreferrer", text });

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
    $("load-error").hidden = false;
    $("load-error").textContent = `Impossible de lire les données (${e.message}). En local : npx serve .`;
    return;
  }
  const srcById = new Map(sources.sources.map((s) => [s.id, s]));
  const items = (cur.items ?? []).filter((i) => i.session === cur.lastSession);
  const kpis = cur.kpis ?? computeKpis(items, sources.sources);

  // Objectifs
  $("smart").textContent = objectives.smart ?? "";
  $("horizons").replaceChildren(...objectives.horizons.flatMap((h) => [
    el("dt", { text: `${h.id} · ${h.timeframe} · ${h.frequency}` }), el("dd", { text: h.objective })]));

  // Indicateurs : un par ligne, avec l'action si l'alerte se déclenche (SLA)
  $("kpis").replaceChildren(
    el("thead", {}, el("tr", {}, ["Indicateur", "Valeur", "Objectif", "État", "Si alerte"].map((h) => el("th", { text: h })))),
    el("tbody", {}, kpiDefs.kpis.map((d) => {
      const st = kpiStatus(d, kpis[d.id]);
      const target = d.direction === "range" ? `${d.target} à ${d.targetMax}` : `≥ ${fmt(d.target, d.unit)}`;
      return el("tr", {}, el("td", { text: d.name }), el("td", { text: fmt(kpis[d.id], d.unit) }),
        el("td", { text: target }), el("td", { class: `status ${st}`, text: STATUS[st] }), el("td", { class: "small", text: d.action }));
    })));

  // Sources
  $("sources").replaceChildren("Sources : ",
    ...sources.sources.flatMap((s, k) => [k ? ", " : "", link(s.url, s.name)]), ".");

  // Dernière session
  $("session-title").textContent = cur.lastSession ? `6. Session du ${longDate(cur.lastSession)}` : "6. Aucune session pour l'instant";
  $("conclusion").textContent = cur.analysis?.conclusion ?? "";
  $("items").replaceChildren(...items.map((i) => el("li", {}, link(i.url, i.title))));

  // Historique
  $("history").replaceChildren(
    el("thead", {}, el("tr", {}, ["Date", "Retenues", "Pertinentes", "Qualité", "Recoupées", "Signaux faibles"].map((h) => el("th", { text: h })))),
    el("tbody", {}, [...(cur.sessions ?? [])].reverse().map((s) => el("tr", {},
      el("td", { text: longDate(s.date) }), el("td", { text: `${s.count}${s.examined ? ` / ${s.examined}` : ""}` }),
      el("td", { text: fmt(s.kpis?.relevance_rate, "%") }), el("td", { text: fmt(s.kpis?.quality_avg, "/5") }),
      el("td", { text: fmt(s.kpis?.crosscheck_rate, "%") }), el("td", { text: s.kpis?.weak_signals ?? "–" })))));

  // Scénarios
  $("scenarios").replaceChildren(...scenarios.scenarios.flatMap((s) => [
    el("dt", { text: s.title }), el("dd", { text: s.summary })]));

  $("foot").textContent = `Prochaine session vers le ${longDate(cur.nextSession)}.`;
}

init();
