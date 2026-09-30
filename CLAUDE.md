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
- Russian names of the closed sets: `src/renderer/src/labels.ts`.
- Rules about patients and periods: `PatientService` (`src/main/services/patients.ts`). The UI never
  validates on a service's behalf; it shows the `UserError` the service throws.

## Conventions

- Lab data is stored as reported (`raw_value`, `ref_raw`, `raw_payload`); interpreting those strings
  belongs to `src/shared/domain`, so a fix there re-reads every stored result without a migration.
- Every mutation emits `data-changed` with its scopes; renderer query keys start with the scope, and
  any `data-changed` event also schedules a backup.
- Dates are ISO `YYYY-MM-DD` strings with no time zone: a sample is collected on a civil date.
- The data folder is `<appData>/my-analyses` (`-dev` for unpackaged runs); `MY_ANALYSES_DATA_DIR`
  (`src/shared/env.ts`) overrides it for tests.
