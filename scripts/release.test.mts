import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIGNING_DIR_ENV } from './mac-signing.mts'
import { PLATFORMS, PUBLISH_DIR, SIGNING_SECRET } from './release-steps.mts'

const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

describe('the release workflow', () => {
  it('builds every platform the release steps know', () => {
    for (const platform of PLATFORMS) expect(workflow).toContain(`- platform: ${platform}\n`)
  })

  it('carries the files each build gathers to the step that publishes them', () => {
    expect(workflow.match(new RegExp(`^ +path: ${PUBLISH_DIR}$`, 'gm'))).toHaveLength(2)
  })

  it('gives the macOS build its signing identity where the release steps look for it', () => {
    expect(workflow).toContain(`${SIGNING_SECRET}: \${{ secrets.${SIGNING_SECRET} }}`)
    expect(workflow.match(new RegExp(`^ +${SIGNING_DIR_ENV}: `, 'gm'))).toHaveLength(2)
  })
})
