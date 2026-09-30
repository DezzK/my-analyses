/**
 * Releases, from the command line. `npm run release` tags the version in package.json and pushes
 * it; CI then builds every platform and publishes them (`.github/workflows/release.yml`):
 *
 *   node scripts/release.mts tag                tag and push, after every check passes here
 *   node scripts/release.mts identity           CI: the macOS signing identity from its secret
 *   node scripts/release.mts build <platform>   build mac, windows or linux into release/publish
 *   node scripts/release.mts publish            CI: publish release/publish as the tag's release
 *
 * `build mac` also runs on a Mac that has the identity `npm run release:identity` created.
 */
import { buildPlatform, importIdentity, PLATFORMS, publish, tagAndPush } from './release-steps.mts'

const [command, argument] = process.argv.slice(2)
const platform = PLATFORMS.find((known) => known === argument)

if (command === 'tag') tagAndPush()
else if (command === 'identity') importIdentity()
else if (command === 'build' && platform) await buildPlatform(platform)
else if (command === 'publish') publish()
else
  throw new Error(`Usage: node scripts/release.mts tag | identity | build <${PLATFORMS.join('|')}> | publish`)
