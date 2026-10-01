import { describe, expect, it } from 'vitest'
import { inferSpecimen, specimenKind, specimenOfMaterial } from './specimens'

describe('inferSpecimen', () => {
  it('reads the specimen a test or an analysis names', () => {
    expect(inferSpecimen('Глюкоза в моче')).toBe('urine')
    expect(inferSpecimen('Общий анализ мочи')).toBe('urine')
    expect(inferSpecimen('Копрограмма')).toBe('stool')
    expect(inferSpecimen('Спермограмма')).toBe('other')
    expect(inferSpecimen('Мазок из зева на флору')).toBe('other')
    expect(inferSpecimen('Цинк в волосах')).toBe('other')
  })

  it('leaves blood, and names that say nothing of the specimen, unknown', () => {
    expect(inferSpecimen('Общий анализ крови')).toBeNull()
    expect(inferSpecimen('Мочевина')).toBeNull()
    expect(inferSpecimen('Калий')).toBeNull()
  })
})

describe('specimenOfMaterial', () => {
  it('reads a sample material, blood included', () => {
    expect(specimenOfMaterial('Моча (разовая)')).toBe('urine')
    expect(specimenOfMaterial('Кровь (сыворотка)')).toBe('serum')
    expect(specimenOfMaterial('Кровь с ЭДТА')).toBe('blood')
    expect(specimenOfMaterial('Пробирка')).toBeNull()
  })
})

describe('specimenKind', () => {
  it('takes serum and plasma for blood', () => {
    expect(specimenKind('serum')).toBe('blood')
    expect(specimenKind('plasma')).toBe('blood')
    expect(specimenKind('urine')).toBe('urine')
  })
})
