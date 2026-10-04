# Veille technologique : développement logiciel

Site de veille (projet scolaire) sur C#/.NET, Angular, GitHub, outils et IA appliquée au développement.
Objectifs SMART H1/H2/H3, KPIs, journal filtrable, sources, biais, scénarios prospectifs H3.

**Site :** https://evo784.github.io/veille-technologique/

## Technologies

HTML, CSS, JavaScript vanilla (modules ES), JSON. Script de mise à jour en Node.js (sans dépendance). Hébergement GitHub Pages.

## Lancement local

```
npx serve .
```

Ouvrir l'adresse affichée. L'ouverture directe de `index.html` ne fonctionne pas (les JSON sont lus avec `fetch`).

## Données (`data/`)

| Fichier | Contenu |
|---|---|
| `objectives.json` | Objectifs H1/H2/H3 |
| `sources.json` | Sources, autorité /5, fréquence, mode de collecte |
| `kpis.json` | Définition, cible, seuil d'alerte, action corrective |
| `scenarios.json` | 3 scénarios H3 |
| `config.json` | Mots-clés, délai (14 jours), seuils |
| `sessions/AAAA-MM-JJ.json` | Une session par veille (infos, KPIs, signaux faibles, ajustements). **Jamais supprimées.** |
| `current.json` | Généré : sessions cumulées + KPIs de la dernière session, lu par le site |

Calcul des KPIs : `js/kpi.js` (partagé entre le site et le script).

## Mise à jour

```
node scripts/update.mjs            # session si la dernière a plus de 14 jours
node scripts/update.mjs --dry-run  # n'écrit rien
node scripts/update.mjs --force    # ignore le délai
node scripts/update.mjs --rebuild  # régénère current.json
```

Le script lit les flux RSS officiels (.NET Blog, GitHub Changelog, GitHub Blog), écarte les doublons, filtre par mots-clés, note chaque information, calcule les KPIs, valide le JSON, puis écrit une nouvelle session. En cas d'erreur, aucun fichier existant n'est modifié.

Limites assumées : la notation automatique est approximative (marquée « Notation auto » sur le site) et le cross-check automatique ne compte que des sources différentes. Les sources sans flux (Learn, angular.dev, Windows AI) sont ajoutées à la main dans une session.

## Automatisation

GitHub Actions (`.github/workflows/veille.yml`) : exécution chaque lundi, le script ne crée une session que si la dernière date de 14 jours ou plus. Si de nouvelles données existent : commit, push, puis déploiement GitHub Pages (`pages.yml`).
Lancement manuel : onglet **Actions > Veille bimensuelle > Run workflow** (case « forcer » possible).

Aucun secret n'est utilisé (flux publics, pas d'API IA).

## Matrice de priorisation / criticité

En attente du cahier des charges « Étude Avant Projet » (section dédiée du site).
