import { join } from 'node:path'
import type { Configuration } from 'electron-builder'
import { signMacApp } from './scripts/mac-signing.mts'
import { APP_ID, MAC_ARCHES, RELEASE_REPO } from './src/shared/release.ts'

/**
 * Installers without app stores: a signed zip per Mac architecture, which the install script and
 * the app's own updater unpack, and an NSIS installer for Windows, which electron-updater runs.
 */
const config: Configuration = {
  appId: APP_ID,
  directories: { output: 'release/${version}', buildResources: 'build' },
  files: ['out/**/*', 'package.json'],
  // The app runs its migrations from `resources/drizzle` (`dataPaths.migrations`).
  extraResources: [{ from: 'drizzle', to: 'drizzle' }],
  mac: {
    target: [{ target: 'zip', arch: [...MAC_ARCHES] }],
    category: 'public.app-category.medical',
    // Signed in `afterPack` with the release identity, which Apple's tooling does not know.
    identity: null,
    artifactName: 'my-analyses-${version}-mac-${arch}.${ext}',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'my-analyses-${version}-win-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    // The data folder outlives the app: uninstalling must never take the results with it.
    deleteAppDataOnUninstall: false,
  },
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return
    await signMacApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`))
  },
  publish: { provider: 'github', owner: RELEASE_REPO.owner, repo: RELEASE_REPO.repo, releaseType: 'release' },
}

export default config
