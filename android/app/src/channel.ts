// Where this build looks for updates. Store build: the public GitHub releases (channel.generated.json is {}).
// Personal build (SC_FLAVOR=personal): a private update file; its address comes only from the gitignored
// config.local.json via tools/gen-channel.sh, never from code in git.
import generated from './channel.generated.json';
const g = generated as { privateSlug?: string; privateUpdatePath?: string };
export const PRIVATE_SITE: string | null = g.privateSlug ? `https://${g.privateSlug}.here.now/` : null;
export const PRIVATE_UPDATE_URL: string | null = PRIVATE_SITE && g.privateUpdatePath ? `${PRIVATE_SITE}${g.privateUpdatePath}/version.json` : null;
export const UPDATE_SOURCE_LABEL = PRIVATE_UPDATE_URL ? 'Updates come from your private install page.' : 'Updates come from the app’s public GitHub releases.';
export const UPDATE_CHECK_SHORT = PRIVATE_UPDATE_URL ? 'to check your private install page for app updates' : 'to check GitHub for app updates';
export const UPDATE_CHECK_LONG = PRIVATE_UPDATE_URL ? 'a once-a-day check of your private install page' : 'a once-a-day check of the app’s public release page on GitHub';
