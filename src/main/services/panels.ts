import { asc, eq, inArray } from 'drizzle-orm'
import type { Panel } from '@shared/api'
import { compareRussian } from '@shared/domain/text'
import { UserError } from '@shared/errors'
import type { Db } from '../db/client'
import { analyte, panel, panelItem } from '../db/schema'
import { inTransaction } from '../db/transaction'
import { dataChanged, type EventSink } from '../events'
import { holdsNeedle, normalizeSearchText, searchNeedle } from './analytes'
import { typedName } from './validation'

/** Owner of panels: named sets of analytes entered and searched together. */
export class PanelService {
  constructor(
    private readonly db: Db,
    private readonly events: EventSink,
  ) {}

  list(): Panel[] {
    const items = Map.groupBy(
      this.db.select().from(panelItem).orderBy(asc(panelItem.position)).all(),
      (i) => i.panelId,
    )
    return this.db
      .select()
      .from(panel)
      .all()
      .sort((a, b) => compareRussian(a.name, b.name))
      .map((row) => ({
        id: row.id,
        name: row.name,
        analyteIds: (items.get(row.id) ?? []).map((i) => i.analyteId),
      }))
  }

  /** Panels whose name holds what was typed, matched as analytes are. */
  search(query: string): Panel[] {
    const needle = searchNeedle(query)
    return needle ? this.list().filter((p) => holdsNeedle(p.name, needle)) : []
  }

  /** Creates a panel (`panelId` null) or replaces a panel's name and analytes, in the given order. */
  save(panelId: number | null, name: string, analyteIds: number[]): Panel {
    const title = typedName(name, 'Введите название набора')
    const ids = [...new Set(analyteIds)]
    if (ids.length === 0) throw new UserError('Добавьте в набор хотя бы один показатель')
    const found = this.db.select({ id: analyte.id }).from(analyte).where(inArray(analyte.id, ids)).all()
    if (found.length !== ids.length) throw new UserError('Показатель не найден')
    const taken = this.list().find(
      (p) => p.id !== panelId && normalizeSearchText(p.name) === normalizeSearchText(title),
    )
    if (taken) throw new UserError('Набор с таким названием уже есть')

    const id = inTransaction(this.db, () => {
      const saved =
        panelId === null
          ? this.db.insert(panel).values({ name: title }).returning({ id: panel.id }).get().id
          : this.find(panelId)
      if (panelId !== null) {
        this.db.update(panel).set({ name: title }).where(eq(panel.id, saved)).run()
        this.db.delete(panelItem).where(eq(panelItem.panelId, saved)).run()
      }
      this.db
        .insert(panelItem)
        .values(ids.map((analyteId, position) => ({ panelId: saved, analyteId, position })))
        .run()
      return saved
    })
    dataChanged(this.events, 'catalog')
    return { id, name: title, analyteIds: ids }
  }

  remove(panelId: number): void {
    this.find(panelId)
    this.db.delete(panel).where(eq(panel.id, panelId)).run()
    dataChanged(this.events, 'catalog')
  }

  private find(panelId: number): number {
    const row = this.db.select({ id: panel.id }).from(panel).where(eq(panel.id, panelId)).get()
    if (!row) throw new UserError('Набор не найден')
    return row.id
  }
}
