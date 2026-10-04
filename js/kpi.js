// Calculs de KPIs partagés entre le site (navigateur) et le script de mise à jour (Node).
// Aucune dépendance. Tout champ null/absent est ignoré, jamais remplacé par une valeur inventée.

export const WEIGHTS = { relevance: 0.3, credibility: 0.25, novelty: 0.25, efficacy: 0.2 };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const mean = (arr) => {
  const xs = arr.filter(isNum);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const pct = (num, den) => (den > 0 ? round((num / den) * 100, 1) : null);

export function qualityScore(item) {
  const { relevance, credibility, novelty, efficacy } = item;
  if (![relevance, credibility, novelty, efficacy].every(isNum)) return null;
  return round(
    relevance * WEIGHTS.relevance + credibility * WEIGHTS.credibility +
    novelty * WEIGHTS.novelty + efficacy * WEIGHTS.efficacy, 2);
}

export function computeKpis(items, sources = []) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const n = items.length;
  const important = items.filter((i) => isNum(i.utility) && i.utility >= 4);
  const nonFr = items.filter((i) => i.lang && i.lang !== "fr");
  return {
    count: n,
    relevance_rate: pct(items.filter((i) => isNum(i.relevance) && i.relevance >= 4).length, n),
    quality_avg: round(mean(items.map((i) => i.quality ?? qualityScore(i)))),
    crosscheck_rate: pct(important.filter((i) => i.crossChecked === true).length, important.length),
    crosscheck_base: important.length,
    weak_signals: items.filter((i) => i.weakSignal === true).length,
    actionable_rate: pct(items.filter((i) => i.actionable === true).length, n),
    nonfr_rate: pct(nonFr.length, items.filter((i) => i.lang).length),
    authority_avg: round(mean(items.map((i) => byId.get(i.source)?.authority))),
    volume: n,
    utility_avg: round(mean(items.map((i) => i.utility))),
  };
}

// Statut d'un KPI par rapport à sa cible et à son seuil d'alerte : "ok" | "warn" | "alert" | "na"
export function kpiStatus(def, value) {
  if (!isNum(value)) return "na";
  if (def.direction === "range") {
    if (value > def.alert || value < def.target - 1) return "alert";
    if (value > def.targetMax || value < def.target) return "warn";
    return "ok";
  }
  if (value >= def.target) return "ok";
  if (value < def.alert) return "alert";
  return "warn";
}

export function distribution(items, keyFn) {
  const out = {};
  for (const it of items) {
    const keys = [].concat(keyFn(it) ?? []);
    for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
