# Herbst Cup — selected source code

Selected source modules from an unofficial companion app for Ishøj Future at Herbst Cup, 17–18 October 2026. The app helped families follow schedules, results, official standings and phase changes across six languages.

This is a new, deliberately limited publication. It does not contain the production repository or its history.

## Included

- `tournament-parser.mjs`: parsing public tournament HTML/embedded JSON without executing upstream scripts.
- `public/identity.js`: participant references scoped to an official plan; explicit official assignments rather than name matching.
- `http-json.mjs`: JSON serialization and HTTP gzip negotiation.
- `tests/`: small synthetic checks for the published modules.
- `docs/design-notes.md`: reusable lessons and limitations.

## Run tests

Use Node.js 22 or newer. No packages, credentials or network access are required.

```sh
npm test
```

## Historical code, not a maintained importer

The parser reflects page formats encountered during the tournament. A later check on 20 October found that the current official pages could not be parsed (`Missing or duplicate cp-rank-cell-goals cell`). Do not use this snapshot as a guarantee of compatibility with the current website. The synthetic tests are intentionally small and do not reproduce the private production test suite.

The original event data belonged to the organizer. Official sources: [Saturday plan](https://www.meinturnierplan.de/showit.php?id=24oqfztx3t) and [Sunday plan](https://www.meinturnierplan.de/showit.php?id=28cmeew7jy). This repository is unofficial and is not endorsed by the organizer, clubs or source provider.

## Publication boundary

Excluded: credentials, environment files, production deployment configuration, backups, result-history exports, raw captured source pages, account details, personal notes, screenshots, and third-party logos/fonts. No deployment or live import runs from this repository.

No open-source licence has been selected for this publication. Public visibility alone does not grant a licence to reuse the code.
