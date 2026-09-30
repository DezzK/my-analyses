import { describe, expect, it } from 'vitest'
import { isNewerVersion, parseMacFeed, releaseFileUrl } from './release'

const SHA512 = 'a'.repeat(128)

describe('release versions', () => {
  it('compares versions number by number', () => {
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
    expect(isNewerVersion('2.0.0-beta', '1.0.0')).toBe(false)
  })
})

describe('the macOS feed', () => {
  const build = { url: releaseFileUrl('0.2.0', 'app.zip'), sha512: SHA512, size: 10 }

  it('reads the builds of a release', () => {
    const feed = parseMacFeed(
      JSON.stringify({ version: '0.2.0', releaseDate: 'd', builds: { arm64: build } }),
    )
    expect(feed).toEqual({ version: '0.2.0', releaseDate: 'd', builds: { arm64: build } })
  })

  it('refuses a feed that is malformed or points outside the releases', () => {
    const feed = (builds: unknown, version = '0.2.0') => JSON.stringify({ version, builds })
    expect(() => parseMacFeed(feed({ arm64: build }, 'latest'))).toThrow('no version')
    expect(() => parseMacFeed(feed({ arm64: { ...build, url: 'https://example.com/app.zip' } }))).toThrow(
      'arm64',
    )
    expect(() => parseMacFeed(feed({ x64: { ...build, sha512: 'abc' } }))).toThrow('x64')
    expect(() => parseMacFeed(feed({ x64: { ...build, size: 0 } }))).toThrow('x64')
  })
})
