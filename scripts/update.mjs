#!/usr/bin/env node
// Mise à jour de la veille : collecte des flux RSS officiels, filtrage par mots-clés,
// notation, KPIs, nouvelle session datée, régénération de data/current.json.
// Aucune dépendance, aucun secret. Le commit/push est fait par le workflow GitHub Actions.
//
// Usage :
//   node scripts/update.mjs              session si la dernière date de plus de 14 jours
//   node scripts/update.mjs --force      ignore le délai de 14 jours
//   node scripts/update.mjs --dry-run    calcule et affiche, n'écrit rien
//   node scripts/update.mjs --rebuild    régénère current.json depuis les sessions existantes
import { readFile, writeFile, readdir, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeKpis, qualityScore, distribution } from "../js/kpi.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const SESSIONS = path.join(DATA, "sessions");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const DAY = 86400000;

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const today = () => process.env.VEILLE_DATE ?? new Date().toISOString().slice(0, 10); // VEILLE_DATE : tests uniquement
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / DAY);

// Écriture atomique : un JSON invalide ne remplace jamais un fichier valide.
async function writeJsonSafe(file, obj) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  JSON.parse(text);
  const tmp = file + ".tmp";
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

async function loadSessions() {
  const files = (await readdir(SESSIONS)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return Promise.all(files.map(async (f) => ({ file: f, ...(await readJson(path.join(SESSIONS, f))) })));
}

// ---------- validation ----------
const REQUIRED = ["id", "title", "summary", "theme", "horizon", "source", "url", "lang", "collectedAt",
  "relevance", "credibility", "novelty", "efficacy", "crossChecked", "weakSignal"];
function validateSession(s, sourceIds) {
  const errs = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? "")) errs.push("date invalide");
  if (!Array.isArray(s.items)) errs.push("items manquant");
  for (const it of s.items ?? []) {
    for (const k of REQUIRED) if (it[k] === undefined) errs.push(`${it.id ?? "?"}: champ « ${k} » manquant`);
    if (!/^https?:\/\//.test(it.url ?? "")) errs.push(`${it.id}: url invalide`);
    for (const k of ["relevance", "credibility", "novelty", "efficacy"])
      if (!(it[k] >= 1 && it[k] <= 5)) errs.push(`${it.id}: ${k} hors 1-5`);
    if (!sourceIds.has(it.source)) errs.push(`${it.id}: source inconnue « ${it.source} »`);
    if (it.crossChecked && !(it.crossCheckWith?.length > 0)) errs.push(`${it.id}: cross-check « oui » sans source de recoupement`);
  }
  return errs;
}

// ---------- collecte ----------
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#8217;/g, "'").replace(/\s+/g, " ").trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
};

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.map((b) => {
    const linkAttr = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated");
    const d = date ? new Date(date) : null;
    return {
      title: tag(b, "title"),
      url: (linkAttr ?? tag(b, "link"))?.trim(),
      published: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null,
      summary: (tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "").slice(0, 400),
    };
  }).filter((e) => e.title && e.url);
}

async function fetchFeed(source) {
  const res = await fetch(source.feed, {
    headers: { "User-Agent": "veille-technologique-bot (projet scolaire; github.com)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// ---------- notation ----------
const THEMES = [
  ["agents-ia", ["agent", "mcp", "ag-ui", "agentic"]],
  ["ia-locale", ["foundry local", "on-device", "onnx", "local model", "windows ai"]],
  ["github-copilot", ["copilot", "github actions", "pull request"]],
  ["angular", ["angular", "signal forms", "webmcp"]],
  ["dotnet-csharp", ["c#", ".net", "asp.net", "blazor", "signalr", "entity framework", "native aot"]],
];
const has = (text, words) => words.filter((w) => text.includes(w));

function scoreCandidate(c, source, cfg, runDate) {
  const text = `${c.title} ${c.summary}`.toLowerCase();
  if (has(text, cfg.keywords.exclude).length) return null;
  const hits = has(text, cfg.keywords.include);
  if (!hits.length) return null;
  const age = c.published ? daysBetween(c.published, runDate) : null;
  const relevance = hits.length >= 3 ? 5 : hits.length === 2 ? 4 : 3;
  const novelty = age === null ? 3 : age <= 3 ? 5 : age <= 7 ? 4 : age <= 14 ? 3 : 2;
  const efficacy = has(text, cfg.keywords.actionable).length ? 4 : 3;
  const theme = THEMES.find(([, w]) => has(text, w).length)?.[0] ?? "outils-dev";
  const early = /experimental|public preview|early access|preview/.test(text);
  const weakSignal = early && ["agents-ia", "ia-locale"].includes(theme);
  const horizon = weakSignal || theme === "agents-ia" || theme === "ia-locale" ? ["H2", "H3"] : ["H1"];
  const item = {
    id: `${c.published ?? runDate}-${source.id}-${c.url.split("/").filter(Boolean).pop().slice(0, 40)}`,
    title: c.title, summary: c.summary || null, theme, horizon, source: source.id, url: c.url, lang: source.lang,
    publishedAt: c.published, collectedAt: runDate,
    relevance, credibility: source.authority, novelty, efficacy, utility: relevance,
    crossChecked: false, crossCheckWith: [], weakSignal,
    actionable: efficacy === 4, action: null,
    review: "auto",
    notes: "Notation automatique par mots-clés (" + hits.slice(0, 4).join(", ") + "). À valider ou corriger à la main.",
  };
  item.quality = qualityScore(item);
  return item;
}

// Vrai recoupement : même entité citée par des sources différentes (autres éditeurs/flux).
function applyCrossCheck(kept, all, entities) {
  for (const it of kept) {
    const text = `${it.title} ${it.summary ?? ""}`.toLowerCase();
    for (const ent of entities.filter((e) => text.includes(e))) {
      const others = all.filter((o) => o.url !== it.url && o.sourceId !== it.source &&
        `${o.title} ${o.summary}`.toLowerCase().includes(ent));
      if (others.length) {
        it.crossChecked = true;
        it.crossCheckWith = [...new Set([...it.crossCheckWith, ...others.slice(0, 2).map((o) => o.url)])];
        it.notes += ` Recoupé via « ${ent} ».`;
      }
    }
  }
}

// ---------- current.json ----------
function finalizeSession(s, sources) {
  for (const it of s.items) it.quality ??= qualityScore(it);
  for (const it of s.items) it.actionable ??= false;
  s.kpis ??= computeKpis(s.items, sources);
  s.byTheme ??= distribution(s.items, (i) => i.theme);
  s.byHorizon ??= distribution(s.items, (i) => i.horizon);
  return s;
}

async function rebuildCurrent(sessions, sources, cfg) {
  const seen = new Set();
  const items = [];
  for (const s of [...sessions].reverse()) // plus récentes d'abord
    for (const it of s.items)
      if (!seen.has(it.url)) { seen.add(it.url); items.push({ ...it, session: s.date }); }
  const last = sessions.at(-1);
  const current = {
    generatedAt: new Date().toISOString(),
    lastSession: last?.date ?? null,
    nextSession: last ? addDays(last.date, cfg.intervalDays) : null,
    intervalDays: cfg.intervalDays,
    kpis: last?.kpis ?? null,
    kpisCumulative: computeKpis(items, sources),
    byTheme: last?.byTheme ?? {},
    byHorizon: last?.byHorizon ?? {},
    weakSignals: last?.weakSignals ?? [],
    adjustments: last?.adjustments ?? null,
    analysis: last?.analysis ?? null,
    examined: last?.examined ?? null,
    sessions: sessions.map((s) => ({ date: s.date, type: s.type ?? null, count: s.items.length, examined: s.examined ?? null, kpis: s.kpis })),
    items,
  };
  return current;
}

// ---------- main ----------
async function main() {
  const cfg = await readJson(path.join(DATA, "config.json"));
  const { sources } = await readJson(path.join(DATA, "sources.json"));
  const sourceIds = new Set(sources.map((s) => s.id));
  await mkdir(SESSIONS, { recursive: true });
  let sessions = await loadSessions();

  if (args.has("--rebuild")) {
    for (const s of sessions) {
      const had = JSON.stringify(s);
      finalizeSession(s, sources);
      const errs = validateSession(s, sourceIds);
      if (errs.length) throw new Error(`Session ${s.date} invalide:\n- ${errs.join("\n- ")}`);
      const { file, ...clean } = s;
      if (!DRY && JSON.stringify(s) !== had) await writeJsonSafe(path.join(SESSIONS, file), clean);
    }
    const cur = await rebuildCurrent(sessions, sources, cfg);
    if (DRY) console.log("[dry-run] current.json non écrit.", cur.kpis);
    else await writeJsonSafe(path.join(DATA, "current.json"), cur);
    console.log(`current.json régénéré depuis ${sessions.length} session(s).`);
    return;
  }

  const runDate = today();
  const last = sessions.at(-1);
  if (last && !args.has("--force") && daysBetween(last.date, runDate) < cfg.intervalDays) {
    console.log(`Dernière session : ${last.date} (${daysBetween(last.date, runDate)} j < ${cfg.intervalDays}). Rien à faire.`);
    return;
  }
  if (sessions.some((s) => s.date === runDate)) throw new Error(`Une session existe déjà pour ${runDate}.`);

  const known = new Set(sessions.flatMap((s) => s.items.map((i) => i.url)));
  const since = last ? last.date : addDays(runDate, -cfg.intervalDays);
  const all = []; const kept = []; const errors = [];
  for (const src of sources.filter((s) => s.feed)) {
    try {
      const entries = (await fetchFeed(src)).map((e) => ({ ...e, sourceId: src.id }));
      all.push(...entries);
      for (const e of entries) {
        if (known.has(e.url) || (e.published && e.published < since)) continue;
        const item = scoreCandidate(e, src, cfg, runDate);
        if (item && item.quality >= cfg.minScoreToKeep) kept.push(item);
      }
      console.log(`✓ ${src.name}: ${entries.length} entrées`);
    } catch (err) {
      errors.push(`${src.name}: ${err.message}`);
      console.warn(`✗ ${src.name}: ${err.message}`);
    }
  }
  if (errors.length === sources.filter((s) => s.feed).length) throw new Error("Tous les flux ont échoué ; aucune session créée.");

  kept.sort((a, b) => b.quality - a.quality);
  const top = kept.slice(0, cfg.maxKeptPerSession);
  applyCrossCheck(top, all, cfg.entities);

  const session = finalizeSession({
    date: runDate, type: "automatique (flux RSS, notation par mots-clés)",
    window: { from: since, to: runDate },
    examined: all.length,
    examinedNote: "Entrées des flux RSS lues ; seules celles parues depuis la dernière session et non déjà connues sont évaluées.",
    items: top,
    weakSignals: top.filter((i) => i.weakSignal).map((i) => i.title),
    adjustments: { sources: errors.map((e) => `Flux en erreur : ${e}`), keywords: [], horizons: [] },
    analysis: { conclusion: `${top.length} informations conservées sur ${all.length} lues. Notation automatique : à valider manuellement.` },
  }, sources);

  const errs = validateSession(session, sourceIds);
  if (errs.length) throw new Error(`Session invalide, rien n'est écrit:\n- ${errs.join("\n- ")}`);
  const cur = await rebuildCurrent([...sessions, session], sources, cfg);

  console.log(`\nSession ${runDate}: ${top.length} conservées / ${all.length} lues. KPIs:`, session.kpis);
  if (DRY) { console.log("[dry-run] aucun fichier écrit."); return; }
  await writeJsonSafe(path.join(SESSIONS, `${runDate}.json`), session);
  await writeJsonSafe(path.join(DATA, "current.json"), cur);
  console.log("Session et current.json écrits.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
