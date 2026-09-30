import { app, BrowserWindow, dialog, type PrintToPDFOptions } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ReportSpec } from '@shared/api'
import { REPORT_PAGE, REPORT_READY_ATTRIBUTE, reportPrintPath } from '@shared/report'
import { appWindowPreferences, loadRenderer, lockNavigation } from './renderer-window'
import type { TrustedWindows } from './windows'

const MM_PER_INCH = 25.4
const inches = (mm: number) => mm / MM_PER_INCH
const MARGIN_INCHES = inches(REPORT_PAGE.marginMm)
const READY_TIMEOUT_MS = 30_000
const READY_POLL_MS = 100
const PREVIEW_WINDOW = { width: 980, height: 1100 }

/** The same pages for the preview, the printer and the saved file; page numbers at the foot. */
const PDF_OPTIONS: PrintToPDFOptions = {
  pageSize: { width: inches(REPORT_PAGE.widthMm), height: inches(REPORT_PAGE.heightMm) },
  printBackground: true,
  margins: { top: MARGIN_INCHES, bottom: MARGIN_INCHES, left: MARGIN_INCHES, right: MARGIN_INCHES },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    // The page's own fonts do not reach the footer, which Chromium draws apart from it.
    '<div style="width:100%;text-align:center;font-family:system-ui,sans-serif;font-size:8px;color:#666">' +
    '<span class="pageNumber"></span> из <span class="totalPages"></span></div>',
}

/**
 * Turns a report into a PDF: the UI draws it out of sight at the width of the page, and Chromium
 * prints that. Previewing and printing go through the same PDF, so the paper matches it page for page.
 */
export class ReportPrinter {
  constructor(
    private readonly deps: {
      windows: TrustedWindows
      parent: () => BrowserWindow | null
    },
  ) {}

  async render(spec: ReportSpec): Promise<Buffer> {
    const window = new BrowserWindow({ show: false, webPreferences: appWindowPreferences() })
    lockNavigation(window)
    this.deps.windows.trust(window.webContents)
    try {
      await loadRenderer(window, reportPrintPath(spec))
      await this.untilReady(window)
      return await window.webContents.printToPDF(PDF_OPTIONS)
    } finally {
      window.destroy()
    }
  }

  /** Shows the report page by page in a window of its own, where it can be printed. */
  async preview(spec: ReportSpec): Promise<void> {
    const file = join(app.getPath('temp'), `my-analyses-report-${Date.now()}.pdf`)
    await writeFile(file, await this.render(spec))
    const parent = this.deps.parent()
    const viewer = new BrowserWindow({
      ...PREVIEW_WINDOW,
      ...(parent ? { parent } : {}),
      title: 'Отчёт',
      webPreferences: { plugins: true, sandbox: true, contextIsolation: true },
    })
    lockNavigation(viewer)
    // The file holds a person's results: it lasts only as long as its window.
    viewer.once('closed', () => void rm(file, { force: true }))
    await viewer.loadFile(file)
  }

  /** Saves the report where the person says; false when they cancel. */
  async save(spec: ReportSpec, fileName: string): Promise<boolean> {
    const parent = this.deps.parent()
    const options = {
      title: 'Сохранить отчёт',
      defaultPath: join(app.getPath('documents'), fileName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }
    const picked = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return false
    await writeFile(picked.filePath, await this.render(spec))
    return true
  }

  private async untilReady(window: BrowserWindow): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const ready = (await window.webContents.executeJavaScript(
        `document.documentElement.hasAttribute(${JSON.stringify(REPORT_READY_ATTRIBUTE)})`,
      )) as boolean
      if (ready) return
      await sleep(READY_POLL_MS)
    }
    throw new Error('The report did not finish drawing')
  }
}
