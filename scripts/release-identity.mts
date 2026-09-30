/** Creates the release signing identity, once for the life of the app: `npm run release:identity`. */
import { createSigningIdentity, signingDir } from './mac-signing.mts'

const identity = createSigningIdentity()
console.log(`Created the release signing identity in ${signingDir()} (SHA-1 ${identity.sha1}).`)
console.log('Back up that folder somewhere safe: installed Macs accept updates signed by this identity only.')
