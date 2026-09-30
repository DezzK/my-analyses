/**
 * The identity macOS builds are signed with: a self-signed certificate in a keychain of its own,
 * kept outside the repository. The app accepts an update only when it is signed by the same
 * certificate as the app itself, so losing this identity means reinstalling every Mac by hand.
 */
import { signApp } from '@electron/osx-sign'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Overrides where the identity lives, for tests. */
export const SIGNING_DIR_ENV = 'MY_ANALYSES_SIGNING_DIR'

const FILES = {
  key: 'signing-key.pem',
  certificate: 'signing-certificate.pem',
  /** The key and certificate together: what to back up, what CI gets, what re-creates the keychain. */
  bundle: 'signing-identity.p12',
  keychain: 'signing.keychain-db',
  config: 'certificate.cnf',
} as const

const COMMON_NAME = 'My Analyses Release Signing'
/** A self-signed certificate never renewed: the app compares certificates, not dates. */
const VALID_DAYS = 36500
/** The keychain has no password, and the .p12's is no secret: both are as safe as their folder. */
const NO_PASSWORD = ''
/** macOS cannot import a .p12 whose password is empty. */
const BUNDLE_PASSWORD = 'my-analyses'

export interface SigningIdentity {
  keychain: string
  /** SHA-1 of the certificate: how codesign names the identity. */
  sha1: string
}

export function signingDir(): string {
  return process.env[SIGNING_DIR_ENV] || join(homedir(), '.config', 'my-analyses-release')
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Creates the identity once; refuses to replace one, since the installed apps trust only it. */
export function createSigningIdentity(dir = signingDir(), commonName = COMMON_NAME): SigningIdentity {
  if (existsSync(join(dir, FILES.bundle))) throw new Error(`A signing identity already exists in ${dir}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(dir, FILES.config),
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = ext',
      'prompt = no',
      '[dn]',
      `CN = ${commonName}`,
      '[ext]',
      'basicConstraints = critical, CA:false',
      'keyUsage = critical, digitalSignature',
      'extendedKeyUsage = critical, codeSigning',
      '',
    ].join('\n'),
  )
  const key = join(dir, FILES.key)
  const certificate = join(dir, FILES.certificate)
  run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:3072',
    '-nodes',
    '-keyout',
    key,
    '-out',
    certificate,
    '-days',
    String(VALID_DAYS),
    '-config',
    join(dir, FILES.config),
  ])
  chmodSync(key, 0o600)
  // The legacy algorithms are the ones the macOS keychain can import.
  run('openssl', [
    'pkcs12',
    '-export',
    '-inkey',
    key,
    '-in',
    certificate,
    '-out',
    join(dir, FILES.bundle),
    '-passout',
    `pass:${BUNDLE_PASSWORD}`,
    '-name',
    commonName,
    '-certpbe',
    'PBE-SHA1-3DES',
    '-keypbe',
    'PBE-SHA1-3DES',
    '-macalg',
    'sha1',
  ])
  chmodSync(join(dir, FILES.bundle), 0o600)
  return signingIdentity(dir)
}

/** Puts an identity exported as .p12 in `dir`: how CI gets the identity from its secret. */
export function importSigningIdentity(p12: Buffer, dir = signingDir()): SigningIdentity {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, FILES.bundle), p12, { mode: 0o600 })
  return signingIdentity(dir)
}

/**
 * The identity in `dir`, its keychain created from the .p12 when missing (on CI, or after a
 * restore from a backup) and unlocked. The keychain is never added to the system's search list.
 */
export function signingIdentity(dir = signingDir()): SigningIdentity {
  if (!existsSync(join(dir, FILES.bundle))) {
    throw new Error(`No signing identity in ${dir}: create it once with \`npm run release:identity\``)
  }
  const keychain = join(dir, FILES.keychain)
  if (!existsSync(keychain)) {
    run('security', ['create-keychain', '-p', NO_PASSWORD, keychain])
    run('security', ['set-keychain-settings', keychain])
    run('security', ['unlock-keychain', '-p', NO_PASSWORD, keychain])
    run('security', [
      'import',
      join(dir, FILES.bundle),
      '-k',
      keychain,
      '-P',
      BUNDLE_PASSWORD,
      '-T',
      '/usr/bin/codesign',
    ])
    // Lets codesign use the key without asking.
    run('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      NO_PASSWORD,
      keychain,
    ])
  }
  run('security', ['unlock-keychain', '-p', NO_PASSWORD, keychain])
  // `1) <SHA-1> "<name>" (CSSMERR_TP_NOT_TRUSTED)`: listed, though not trusted, which it need not be.
  const listed = run('security', ['find-identity', '-p', 'codesigning', keychain])
  const sha1 = /^\s*\d+\)\s+([0-9A-F]{40})\s/m.exec(listed)?.[1]
  if (!sha1) throw new Error(`The keychain in ${dir} holds no signing identity`)
  return { keychain, sha1 }
}

/** Signs an app bundle, every binary inside first, with the identity. */
export async function signMacApp(app: string, identity = signingIdentity()): Promise<void> {
  await signApp({
    app,
    identity: identity.sha1,
    keychain: identity.keychain,
    // Only a certificate Apple issued would pass validation; this one is checked by the app itself.
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    // The hardened runtime would refuse Electron's frameworks without an Apple team to match, and
    // Apple's timestamp means nothing for this certificate: without it, signing needs no network.
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  })
}
