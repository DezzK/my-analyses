import { describe, expect, it } from 'vitest'
import { lab } from '../db/schema'
import { createTestServices } from '../test-support'
import { BUILTIN_LABS, LAB_MARKERS } from './labs'

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

describe('lab markers', () => {
  it('keep the first round as labs have always received it', () => {
    expect(LAB_MARKERS.slice(0, 6)).toEqual([
      { color: '#0072B2', shape: 'circle' },
      { color: '#D55E00', shape: 'triangle' },
      { color: '#009E73', shape: 'diamond' },
      { color: '#CC79A7', shape: 'rect' },
      { color: '#E69F00', shape: 'roundRect' },
      { color: '#56B4E9', shape: 'pin' },
    ])
  })

  it('give every lab a pair of color and shape no other lab has, while pairs last', () => {
    const app = createTestServices()
    while (app.labs.list().length < LAB_MARKERS.length)
      app.labs.create(`Лаборатория ${app.labs.list().length}`)
    const pairs = app.labs.list().map((lab) => `${lab.markerColor} ${lab.markerShape}`)
    expect(new Set(pairs).size).toBe(LAB_MARKERS.length)
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
