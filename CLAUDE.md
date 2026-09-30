# My Analyses («Мои анализы»)

Electron desktop app for macOS and Windows that keeps a family's lab results: imports them from lab
personal accounts through an embedded browser, shows tables and charts, prints reports. The spec
(in Russian) is the Claude Doc «ТЗ v2 — «Мои анализы»». UI text is Russian; code, comments and
commits are English.

## Commands

- `npm run dev` — app with hot reload; `npm run build` — bundles into `out/`.
- `npm run typecheck`, `npm test` (Vitest). Main-process tests build their services with
  `createTestServices` (`src/main/test-support.ts`), wired as the app wires them.
- `npx playwright test` — end-to-end against the built app (`npm run build` first); set
  `SCREENSHOT_DIR` to save screenshots of each step. `withDatabase` (`e2e/app.ts`) prepares a state
  the UI cannot reach alone, such as a connected lab account, while the app is closed; `seedImports`
  puts a patient's orders in through the app's own import.
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
- Reading lab strings: numbers and their precision (`numbers.ts`, `DECIMAL_PATTERN`; stored numbers
  through `numberFromStored`), values,
  bounds and qualitative words (`values.ts`), reference ranges (`references.ts`) — all under
  `src/shared/domain`.
- Units: the built-in dictionary, spelling normalization and conversion (`src/shared/domain/units.ts`);
  a unit's scale relates it to its dimension, molar mass bridges molar and mass concentrations.
- Which reference applies and whether a value deviates: `chooseRule`, `evaluate` and `isDeviation` in
  `src/shared/domain/references.ts`; trimesters and other conditions: `src/shared/domain/conditions.ts`.
- How a stored result is shown: its value in the chosen unit, the reference that applies (the lab's,
  then the lab's rule, then the general rule), the verdict and whether the lab agrees: `interpret`
  (`src/shared/domain/interpret.ts`). The main process reads results only through `ResultReader`
  (`src/main/services/results.ts`), so tables, charts, orders and reports never disagree.
- Russian names of the closed sets: `src/renderer/src/labels.ts`.
- Heading weight and icon sizes: `TITLE_WEIGHT` and `ICON_SIZE` (`src/renderer/src/theme.ts`).
- Rules about patients and periods: `PatientService` (`src/main/services/patients.ts`). The UI never
  validates on a service's behalf; it shows the `UserError` the service throws.
- Which spelling means which unit, the built-in units in the database, and mapping an unknown
  spelling onto a unit (or keeping it as its own): `UnitService`.
- The review queue after imports: new analytes and what they may be merged with, unknown units,
  orders whose norms need a cycle phase (`cycleOn`, `CYCLE_PHASE_CONDITIONS` in
  `src/shared/domain/conditions.ts`), results the lab judged otherwise: `MappingService`.
- Labs, their chart markers (`LAB_MARKERS`), the built-in labs and which connector serves a lab
  (`LabService.connector`): `LabService`.
- Analytes, their lab codes, the unit each is shown in, search and the FTS index
  (`normalizeSearchText`): `AnalyteService`.
- Orders, their summaries and original forms: `OrderService` (`src/main/services/orders.ts`).
- Merging one analyte into another and undoing it: `MergeService`; reference rules and their
  consistency (one rule per lab, sex, condition and age): `RuleService`; panels: `PanelService`.
- Services are wired once, by `createServices` (`src/main/services/index.ts`), for the app and
  for the tests alike.
- Age limits of rules stated in years, months or days, and back: `ageToDays`, `daysToAge`
  (`src/shared/domain/age.ts`).
- Turning a lab's report into orders and results (dedup, protecting hand edits, new analytes for
  unknown codes): `ImportService` (`src/main/import/importer.ts`). Connectors only return
  `RawOrder`s (`src/main/lab/types.ts`); original forms go to `AttachmentStore`.
- Connected lab accounts: connecting, logging in again, syncing, the run history and which orders a
  sync fetches again (`RECHECK_DAYS`): `SyncService` (`src/main/import/sync.ts`).
- The embedded browser: a persistent session partition per account, pages kept on the lab's hosts,
  the login window that closes itself once the person is in: `LabBrowser` (`src/main/lab/browser.ts`).
  Services depend on its `LabSessions` port; tests use a fake one.
- Folding case and ё for every word comparison: `foldCase` (`src/shared/domain/text.ts`).
- Names inside the data folder: `DATA_FILES` (`src/main/paths.ts`).
- In the UI, a failed call is reported with `notifyError` (`src/renderer/src/notify.ts`), and a lab is
  drawn with its color and shape by `LabMarker`. Values and references are spelled by `valueText` and
  `referenceText` (`src/renderer/src/results/format.ts`), shown by `ResultsTable` and by
  `ResultsChart`, whose options come from `buildChartOption` (`src/renderer/src/results/chart.ts`).
  Labs and units by id: `useLabMap`, `useUnits`. Links with route params: `AnchorLink`,
  `ButtonLink` (`src/renderer/src/components/links.tsx`). Numbers typed into fields: `readDecimal`
  (`src/renderer/src/input.ts`). An action that can be undone reports itself with `notifyUndoable`.
  The platform check: `IS_MAC` (`src/renderer/src/platform.ts`).
- Numbers in Russian spelling: `formatDecimal` (as measured), `formatSignificant` (after a
  conversion) and `formatNumber` (shortest, e.g. axis ticks), all in `src/shared/domain/numbers.ts`.

## Conventions

- Lab data is stored as reported (`raw_value`, `ref_raw`, `raw_payload`); interpreting those strings
  belongs to `src/shared/domain`, so a fix there re-reads every stored result without a migration.
- Every mutation emits `data-changed` with its scopes; renderer query keys start with the scope, and
  any `data-changed` event also schedules a backup. Queries computed from several scopes at once
  (interpreted results, orders, search) start with `derived` and refresh on a change to any of them
  (`src/renderer/src/queries.ts`).
- Dates are ISO `YYYY-MM-DD` strings with no time zone: a sample is collected on a civil date.
- The data folder is `<appData>/my-analyses` (`-dev` for unpackaged runs); `MY_ANALYSES_DATA_DIR`
  (`src/shared/env.ts`) overrides it for tests.
