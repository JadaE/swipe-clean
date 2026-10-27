// The ONE place app code reads deploy config. Values come from src/config.generated.json, which tools/sync-config.sh
// writes from the repo-root config.local.json (or config.example.json when that is missing). No literal slugs/paths elsewhere.
import generated from './config.generated.json';

const g = generated as { slug: string; updateChannelPath: string };
export const SITE_SLUG: string = g.slug;
export const SITE: string = `https://${g.slug}.here.now/`;
export const UPDATE_URL: string = `${SITE}${g.updateChannelPath}/version.json`;
