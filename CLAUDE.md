# My Analyses («Мои анализы»)

Electron desktop app for macOS and Windows that keeps a family's lab results: imports them from lab
personal accounts through an embedded browser, shows tables and charts, prints reports. The spec
(in Russian) is the Claude Doc «ТЗ v2 — «Мои анализы»». UI text is Russian; code, comments and
commits are English.

## Commands

- `npm run dev` — app with hot reload; `npm run build` — bundles into `out/`.
- `npm run typecheck`, `npm test` (Vitest).
- `npx playwright test` — end-to-end against the built app (`npm run build` first); set
  `SCREENSHOT_DIR` to save screenshots of each step.
- `npm run db:generate` — after changing `src/main/db/schema.ts`; commit the new `drizzle/` folder.

## Layout

- `src/main` — Electron main process: SQLite through `node:sqlite` + Drizzle, services, backups, IPC.
- `src/preload` — exposes `window.bridge` (`invoke` + `onEvent`) and nothing else.
- `src/renderer` — React + Mantine UI; reaches the main process only through `src/renderer/src/api.ts`.
- `src/shared` — pure code used by both sides: the API contract, domain rules, closed sets.
- `drizzle/` — migrations shipped with the app, generated ones and hand-written SQL (FTS5 index).
- `e2e/` — Playwright tests that drive the real app against a throwaway data folder.

## Homes (one home per fact)

- Closed sets (sexes, periods, conditions, flags, marker shapes): `src/shared/domain/enums.ts`;
  the schema's CHECK constraints are built from the same arrays.
- UI ↔ main contract (`Api`, `DataScope`, `AppEvent`, channel names): `src/shared/api.ts`,
  implemented once in `src/main/api.ts`.
- Backup retention, delay and file naming: `src/shared/backup-policy.ts`.
- Civil-date arithmetic: `src/shared/domain/dates.ts`; age: `src/shared/domain/age.ts`.
- Reading lab strings: numbers and their precision (`numbers.ts`, `DECIMAL_PATTERN`), values,
  bounds and qualitative words (`values.ts`), reference ranges (`references.ts`) — all under
  `src/shared/domain`.
- Units: the built-in dictionary, spelling normalization and conversion (`src/shared/domain/units.ts`);
  a unit's scale relates it to its dimension, molar mass bridges molar and mass concentrations.
- Which reference applies and whether a value deviates: `chooseRule` and `evaluate` in
  `src/shared/domain/references.ts`; trimesters and other conditions: `src/shared/domain/conditions.ts`.
- Russian names of the closed sets: `src/renderer/src/labels.ts`.
- Rules about patients and periods: `PatientService` (`src/main/services/patients.ts`). The UI never
  validates on a service's behalf; it shows the `UserError` the service throws.
- Which spelling means which unit, and the built-in units in the database: `UnitService`.
- Labs, their chart markers (`LAB_MARKERS`) and the built-in labs: `LabService`.
- Analytes, their lab codes and the FTS index (`normalizeSearchText`): `AnalyteService`.
- Turning a lab's report into orders and results (dedup, protecting hand edits, new analytes for
  unknown codes): `ImportService` (`src/main/import/importer.ts`). Connectors only return
  `RawOrder`s (`src/main/lab/types.ts`); original forms go to `AttachmentStore`.
- Folding case and ё for every word comparison: `foldCase` (`src/shared/domain/text.ts`).

## Conventions

- Lab data is stored as reported (`raw_value`, `ref_raw`, `raw_payload`); interpreting those strings
  belongs to `src/shared/domain`, so a fix there re-reads every stored result without a migration.
- Every mutation emits `data-changed` with its scopes; renderer query keys start with the scope, and
  any `data-changed` event also schedules a backup.
- Dates are ISO `YYYY-MM-DD` strings with no time zone: a sample is collected on a civil date.
- The data folder is `<appData>/my-analyses` (`-dev` for unpackaged runs); `MY_ANALYSES_DATA_DIR`
  (`src/shared/env.ts`) overrides it for tests.
