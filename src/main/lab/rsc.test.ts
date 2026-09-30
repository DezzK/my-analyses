import { describe, expect, it } from 'vitest'
import { objectsWithKey } from './rsc'

describe('objectsWithKey', () => {
  it('finds objects that own the key anywhere in a streamed payload', () => {
    const payload = [
      '0:["$","$L1",null,{"children":["$","div",null,{"className":"page"}]}]',
      '5:{"orders":[{"orderId":1,"createAt":10,"regionDb":5},{"orderId":2,"createAt":20,"regionDb":5}]}',
      '6:["$","a",null,{"href":"/account/order-user-analysis/x?orderId=1"}]',
      '7:{"person":{"surname":"Иванова","name":"Анна","note":"has a } brace and a \\" quote"}}',
    ].join('\n')
    expect(objectsWithKey(payload, 'orderId')).toEqual([
      { orderId: 1, createAt: 10, regionDb: 5 },
      { orderId: 2, createAt: 20, regionDb: 5 },
    ])
    expect(objectsWithKey(payload, 'surname')).toEqual([
      { surname: 'Иванова', name: 'Анна', note: 'has a } brace and a " quote' },
    ])
  })

  it('returns nothing when the key is absent', () => {
    expect(objectsWithKey('1:{"a":1}', 'orderId')).toEqual([])
  })
})
