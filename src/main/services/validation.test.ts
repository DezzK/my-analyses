import { describe, expect, it } from 'vitest'
import { MAX_NAME_LENGTH, typedName } from './validation'

describe('typed names', () => {
  it('trims a name, and refuses an empty one or one too long', () => {
    expect(typedName('  Щитовидная железа ', 'Введите название')).toBe('Щитовидная железа')
    expect(() => typedName('   ', 'Введите название')).toThrow('Введите название')
    expect(typedName('а'.repeat(MAX_NAME_LENGTH), 'Введите название')).toHaveLength(MAX_NAME_LENGTH)
    expect(() => typedName('а'.repeat(MAX_NAME_LENGTH + 1), 'Введите название')).toThrow(
      `Название длиннее ${MAX_NAME_LENGTH} символов`,
    )
    expect(() => typedName('Анна-Мария', 'Укажите имя', { maxLength: 5, noun: 'Имя' })).toThrow(
      'Имя длиннее 5 символов',
    )
  })
})
