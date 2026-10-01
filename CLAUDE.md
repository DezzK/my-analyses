# My Analyses («Мои анализы»)

Electron desktop app for macOS, Windows and Linux that keeps a family's lab results: imports them
from lab personal accounts through an embedded browser, shows tables and charts, prints reports. The
spec (in Russian) is the Claude Doc «ТЗ v2 — «Мои анализы»». The UI, the release notes and the README
are Russian, since the app serves Russian labs and their patients only; code, comments, CLAUDE.md
and commits are English.

## Commands

- `npm run dev` — app with hot reload; `npm run build` — bundles into `out/`.
- `npm run typecheck`, `npm test` (Vitest). Main-process tests build their services with
  `createTestServices` (`src/main/test-support.ts`), wired as the app wires them.
- `npx playwright test` — end-to-end against the built app (`npm run build` first); set
  `SCREENSHOT_DIR` to save screenshots of each step. `withDatabase` (`e2e/app.ts`) prepares a state
  the UI cannot reach alone, such as a connected lab account, while the app is closed; `seedImports`
  puts a patient's orders in through the app's own import.
- `npm run db:generate` — after changing `src/main/db/schema.ts`; commit the new `drizzle/` folder.
  A rename cannot be generated without a terminal: `drizzle-kit generate --custom`, write the SQL,
  and bring the new folder's `snapshot.json` in line with the schema (generate must then report no
  changes). Test a data migration against `someMigrations` (`src/main/test-support.ts`).

- `npm run check` — every check CI runs: types, unit tests, the bundle, end-to-end tests.
- `npm run release` tags the version in `package.json` and pushes it once `npm run check` passes;
  CI (`.github/workflows/release.yml`) then builds the Mac zips (signed in `afterPack`), the Windows
  installer and the Linux AppImage, writes `latest-mac.json` and `install.sh`, and publishes the
  GitHub release — the steps are `scripts/release-steps.mts`. `node scripts/release.mts build mac`
  tries the Mac build here. Macs are signed with the identity `npm run release:identity` creates once
  in `~/.config/my-analyses-release`; CI gets its `.p12` from the `MAC_SIGNING_P12` secret. Back that
  folder up: installed Macs accept updates signed by it alone. `npm run icon` renders `build/icon.svg`.

## Layout

- `src/main` — Electron main process: SQLite through `node:sqlite` + Drizzle, services, backups, IPC.
- `src/preload` — exposes `window.bridge` (`invoke` + `onEvent`) and nothing else.
- `src/renderer` — React + Mantine UI; reaches the main process only through `src/renderer/src/api.ts`.
- `src/shared` — pure code used by both sides: the API contract, domain rules, closed sets.
- `drizzle/` — migrations shipped with the app, generated ones and hand-written SQL (FTS5 index).
- `e2e/` — Playwright tests that drive the real app against a throwaway data folder.
- `scripts/` — release tooling that Node runs as is (`.mts`, relative imports with extensions);
  `build/` — the app icon for installers.

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
  a unit's scale relates it to its dimension, molar mass bridges molar and mass concentrations. Other
  tables name a built-in unit by its `UnitCode`.
- The built-in analyte dictionary: its entries — names, units, specimen, molar mass — in
  `src/main/dictionary/entries.ts`; which entry an analyte is, by its names read word by word
  (`nameKey`) and by its unit, specimen and kind of values (`findEntry`, `src/main/dictionary/match.ts`);
  applying it — an entry's analytes are merged, for the person to confirm, into the one the person
  looked at or with the most results, which is linked to the entry; never two with results in one
  order nor one the person split out (`separated`) — `AnalyteDictionary`
  (`src/main/services/dictionary.ts`), after each imported order and at every start. A finding named
  alike in analyses of several specimens («Лейкоциты», «Слизь») is an entry only within an analysis
  of its specimen (`contextual`).
- Which reference applies and whether a value deviates: `chooseRule`, `evaluate` and `isDeviation` in
  `src/shared/domain/references.ts`; trimesters and other conditions: `src/shared/domain/conditions.ts`.
- How a stored result is shown: its value in the chosen unit, the reference that applies (the lab's,
  then the lab's rule, then the general rule), the verdict and whether the lab agrees: `interpret`
  (`src/shared/domain/interpret.ts`). The main process reads results only through `ResultReader`
  (`src/main/services/results.ts`), so tables, charts, orders and reports never disagree.
- Russian names of the closed sets, and the Russian forms of nouns counted in the UI (`ORDER_FORMS`,
  `ANALYTE_FORMS`): `src/renderer/src/labels.ts`.
- Heading weight and icon sizes: `TITLE_WEIGHT` and `ICON_SIZE` (`src/renderer/src/theme.ts`).
- Rules about patients and periods: `PatientService` (`src/main/services/patients.ts`). The UI never
  validates on a service's behalf; it shows the `UserError` the service throws.
- Which spelling means which unit, the built-in units in the database, and mapping an unknown
  spelling onto a unit (or keeping it as its own): `UnitService`.
- The review queue after imports: new analytes and what they may be merged with (never one of another
  specimen), the dictionary's merges, unknown units,
  orders whose norms need a cycle phase (`cycleOn`, `CYCLE_PHASE_CONDITIONS` in
  `src/shared/domain/conditions.ts`), results the lab judged otherwise: `MappingService`.
- Labs, their chart markers (`LAB_MARKERS`), the built-in labs and which connector serves a lab
  (`LabService.connector`): `LabService`.
- Analytes, their lab codes with the analysis each is part of, the unit each is shown in, search and
  the FTS index (`normalizeSearchText`), and what a search matches (`searchNeedle`, `holdsNeedle`,
  which panels are searched by as well): `AnalyteService`. The specimen of a lab's test — its name's,
  else the lab's, else its analysis's (`specimenOfTest`) — is set when an import meets the code, and
  later when the lab names it (`noteContext`). Which specimen a name or an analysis states
  (`inferSpecimen`), which a lab's material does (`specimenOfMaterial`), and that serum and plasma
  are blood (`specimenKind`): `src/shared/domain/specimens.ts`.
- Orders, their summaries and original forms, entering them by hand and correcting results (what
  a typed order must satisfy, the ten-times warning, undoing a delete): `OrderService`
  (`src/main/services/orders.ts`). An order's original forms — several when the lab issues one per
  sample or per group of tests — belong to `OrderForms` (`src/main/services/order-forms.ts`); the
  files, PDFs or photos stored as `<sha256>.<ext>`, to `AttachmentStore` (`FORM_EXTENSIONS`,
  `src/main/attachments.ts`).
- A typed date that must be real and not in the future: `assertPastDate`; a typed name, trimmed and
  neither empty nor too long: `typedName` (both in `src/main/services/validation.ts`). The unit an
  analyte is shown in: `shownUnitId`.
- Merging one analyte into another and undoing it, and which merges wait for the person to look at
  them (`reviewed`): `MergeService`; an analyte's places in named lists (panel items, report blocks,
  dictionary links) move and come back by one rule, `movePlaces` and `restorePlaces` over a `Places`
  table. Reference rules and their consistency (one rule per lab,
  sex, condition and age): `RuleService`; panels, and finding them by name: `PanelService`. A panel's
  page shows all its analytes' results (`src/renderer/src/analytes/PanelPage.tsx`).
- Report templates (blocks as `report_block` rows, layout as JSON) and what a report must satisfy
  to be built (`checkSpec`): `ReportService` (`src/main/services/reports.ts`). The paper, the width
  a report is laid out at, the default layout and the print route with the spec in its address
  (`reportPrintPath`, read back by `reportSpecFrom`): `src/shared/report.ts`. Turning a report into
  a PDF — a hidden window on that route, drawn without the shell and always light, that says when it
  is ready, then `printToPDF` — and the preview and save: `ReportPrinter`
  (`src/main/report-printer.ts`). Which blocks share a row: `rowsOf`
  (`src/renderer/src/reports/rows.ts`); the report being built is kept by `useReportDraft`, and
  analytes, one or a panel's, join it through `withAnalytes`.
- Which windows may call the API: `TrustedWindows` (`src/main/windows.ts`); how a window loads the
  UI, with which web preferences, and that nothing navigates it away: `loadRenderer`,
  `appWindowPreferences`, `lockNavigation` (`src/main/renderer-window.ts`).
- Where releases live and how the app finds them (repository, feed and install-script names, the
  bundle id, comparing versions, reading the macOS feed): `src/shared/release.ts`, read by the build
  config (`electron-builder.ts`), the release scripts and the app alike.
- The app's own updates — when to check, the status the UI shows, installing on quit or with a
  restart: `UpdateService`; each platform's way behind `Updater`: `MacUpdater` (feed, SHA-512, the
  signature against the running app's designated requirement, swapping bundles after the app quits)
  and `AutoUpdater` (electron-updater: the Windows installer, the Linux AppImage) — all in
  `src/main/updates/`. The release signing identity
  and signing: `scripts/mac-signing.mts`; the Mac install script: `scripts/install-macos.sh`, filled
  in by `scripts/release-steps.mts`.
- Services are wired once, by `createServices` (`src/main/services/index.ts`), for the app and
  for the tests alike. A change spanning services runs in `inTransaction` (`src/main/db/transaction.ts`);
  called inside another, it joins that one.
- Age limits of rules stated in years, months or days, and back: `ageToDays`, `daysToAge`
  (`src/shared/domain/age.ts`).
- Turning a lab's report into orders and results (dedup, protecting hand edits, new analytes for
  unknown codes, handed to the dictionary once their order is in; what a newer connector says of a
  report already stored): `ImportService` (`src/main/import/importer.ts`). Connectors only return
  `RawOrder`s and their forms (`LabConnector` in `src/main/lab/types.ts`, one file per lab in
  `src/main/lab/connectors/`); each result names the analysis it is part of and its specimen when the
  lab says (`RawResult.analysis`, `specimen`); a site that refreshes its own session names a quiet `syncUrl` for
  syncs and a `detectLogin` for the login window. What several labs' pages share — the VPN refusal
  (`detectVpnBlock`), telling a PDF from an error page served in its place (`isPdf`) — lives in
  `src/main/lab/pages.ts`; reading a list served page by page, in `collectPages`
  (`src/main/lab/paging.ts`); Unix times, whether a token is still good to use (`tokenUsable`) and
  the Moscow dates labs file samples under, in `src/main/lab/time.ts`. Every script the embedded
  browser runs in a lab's page — a request and how its response is read, the page's localStorage
  (`LabPage.readStorage`/`writeStorage`) — lives in `src/main/lab/page-scripts.ts`, where tests run
  it; a request is one async function, since a site may patch promises (Helix's zone.js does). A
  site with no API, only pages rendered on the server (DNKOM), is read in the main process with
  `node-html-parser`.
- Connected lab accounts: connecting, logging in again, syncing, the run history and which orders a
  sync fetches again — recent ones (`RECHECK_DAYS`) and every one an older `LabConnector.version`
  read, so a connector fixed to fetch more (forms, say) brings it for orders already imported;
  syncing all accounts at once, the labs side by side and one lab's accounts one after another:
  `SyncService` (`src/main/import/sync.ts`).
- Whose each imported order is: `LabPeople` (`src/main/services/lab-people.ts`). A connector names
  the person an order is of (`OrderRef.person`) when its lab says; the person using the app chooses
  the patient once per person of an account (the one born the same day is offered, never assumed),
  their orders wait until then and follow them if the choice changes. An order of nobody goes to the
  account's patient. Moving orders to another patient, and the rules that come with it:
  `OrderService.moveToPatient`.
- The embedded browser: a persistent session partition per account, pages kept on the lab's hosts,
  the login window that closes itself once the person is in: `LabBrowser` (`src/main/lab/browser.ts`).
  Services depend on its `LabSessions` port; tests use a fake one.
- Folding case and ё for every word comparison: `foldCase` (`src/shared/domain/text.ts`).
- Names inside the data folder: `DATA_FILES` (`src/main/paths.ts`).
- In the UI, a failed call is reported with `notifyError` (`src/renderer/src/notify.ts`), and a lab is
  drawn with its color and shape by `LabMarker`. Values and references are spelled by `valueText` and
  `referenceText` (`src/renderer/src/results/format.ts`), shown by `ResultsTable` and by
  `ResultsChart`, whose options come from `buildChartOption` (`src/renderer/src/results/chart.ts`).
  A page of results — an analyte's or a panel's — keeps the period and the look last chosen
  (`useResultsPeriod`, `useResultsLook`) and shows each analyte through `ResultsView`
  (`src/renderer/src/results/ResultsView.tsx`); which results a view, a report included, shows:
  `collectedBetween`, `isPlottable` (`src/renderer/src/results/shown.ts`).
  Labs and units by id: `useLabMap`, `useUnits`; lab codes after their labs' names and before their
  analysis: `labCodesText` (`src/renderer/src/format.ts`). Links with route params: `AnchorLink`,
  `ButtonLink` (`src/renderer/src/components/links.tsx`). Dates are typed in `DateField`. Numbers typed into fields: `readDecimal`
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
