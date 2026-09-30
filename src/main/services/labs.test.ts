import { describe, expect, it } from 'vitest'
import { lab } from '../db/schema'
import { createTestServices } from '../test-support'
import { BUILTIN_LABS } from './labs'

describe('built-in labs', () => {
  it('get the connector a new version ships on the next start', () => {
    const app = createTestServices()
    // An install from before any connector existed.
    app.db.update(lab).set({ connectorId: null }).run()
    app.labs.ensureBuiltins()
    const connectors = new Map(
      app.db
        .select()
        .from(lab)
        .all()
        .map((row) => [row.name, row.connectorId]),
    )
    for (const { name, connectorId } of BUILTIN_LABS) expect(connectors.get(name), name).toBe(connectorId)
  })
})

describe('lab accounts', () => {
  it("are named after the person the lab's pages show, and keep the name when they show nobody", () => {
    const app = createTestServices()
    const account = app.labs.createAccount(app.kdlId, app.anna.id)
    const labelOf = () => app.labs.getAccount(account.id).label
    app.labs.recordIdentity(account.id, { externalId: null, label: null })
    expect(labelOf()).toBe('KDL')
    app.labs.recordIdentity(account.id, { externalId: null, label: 'Иванова Анна' })
    expect(labelOf()).toBe('Иванова Анна')
    app.labs.recordIdentity(account.id, { externalId: null, label: null })
    expect(labelOf()).toBe('Иванова Анна')
  })
})
