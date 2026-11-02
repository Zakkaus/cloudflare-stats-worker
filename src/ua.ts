// User-Agent parsing, bot/AI-crawler exclusion, and referrer parsing.
//
// Bot exclusion is a hard requirement: bot traffic is never recorded. We gate
// on two layers — (1) a deterministic regex covering AI crawlers and generic
// bot tokens (fast, explicit, easy to extend), and (2) ua-parser-js's Crawlers
// extension (browser.type === 'crawler'). Either match => excluded.

import { UAParser } from "ua-parser-js";
import { Crawlers } from "ua-parser-js/extensions";

// AI crawlers + assistants. These often are NOT in generic bot lists, so we
// list them explicitly. Keep this updated as new agents appear.
const AI_CRAWLER_RE =
  /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|CCBot|Google-Extended|GoogleOther|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|Applebot-Extended|meta-externalagent|meta-externalfetcher|FacebookBot|Diffbot|ImagesiftBot|Omgilibot|Omgili|YouBot|cohere-ai|DuckAssistBot|Timpibot|Kangaroo Bot|PetalBot|Scrapy|python-requests|node-fetch|axios|Go-http-client|Java\/|okhttp|libwww-perl|curl\/|Wget)/i;

// Generic bot / crawler / monitoring tokens.
const GENERIC_BOT_RE =
  /(bot|crawler|crawl|spider|slurp|mediapartners|feedfetcher|facebookexternalhit|bingpreview|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot|statuscake|gtmetrix|pagespeed|chrome-lighthouse|prerender|dataprovider|semrush|ahrefs|mj12bot|dotbot|screaming frog|archive\.org_bot|ia_archiver)/i;

/**
 * Returns true if the User-Agent belongs to a bot / crawler / non-human client.
 * Empty or missing UA is treated as a bot (real browsers always send one).
 */
export function isBot(userAgent: unknown): boolean {
  if (!userAgent || typeof userAgent !== "string") {
    return true;
  }
  if (AI_CRAWLER_RE.test(userAgent) || GENERIC_BOT_RE.test(userAgent)) {
    return true;
  }
  try {
    const { type } = new UAParser(userAgent, Crawlers).getBrowser();
    if (type === "crawler") {
      return true;
    }
  } catch {
    // parser/extension issue: fall back to regex result (already false here)
  }
  return false;
}

const UNKNOWN = "Unknown";

function clean(value: unknown): string {
  if (value === undefined || value === null) return UNKNOWN;
  const s = `${value}`.trim();
  return s ? s : UNKNOWN;
}

// Browser version is stored as major version only (e.g. "153" from
// "153.0.8010.24") -- point releases don't change what web features are
// supported and only bloat the dimension table / widen the dashboard.
function majorVersion(value: string): string {
  if (value === UNKNOWN) return value;
  return value.split(".")[0] || UNKNOWN;
}

/**
 * Parse a User-Agent into normalized OS / browser / device dimensions.
 * device.type is normalized to 'desktop' when ua-parser-js leaves it undefined.
 */
export interface ParsedUserAgent {
  os: { name: string; version: string };
  browser: { name: string; version: string };
  device: { type: string; vendor: string; model: string };
}

export function parseUserAgent(userAgent: string): ParsedUserAgent {
  const parser = new UAParser(userAgent || "");
  const os = parser.getOS();
  const browser = parser.getBrowser();
  const device = parser.getDevice();

  return {
    os: { name: clean(os.name), version: majorVersion(clean(os.version)) },
    browser: { name: clean(browser.name), version: majorVersion(clean(browser.version)) },
    device: {
      type: device.type ? clean(device.type) : "desktop",
      vendor: clean(device.vendor),
      model: clean(device.model),
    },
  };
}

/**
 * Parse the client-reported referrer (document.referrer) into a domain.
 * - empty referrer            => { domain: null }  (direct)
 * - same-origin as the site   => { domain: '(internal)' }
 * - external                  => { domain: <hostname> }
 *
 * `referrer` is the raw document.referrer from the beacon payload; `siteOrigin`
 * the configured allowed site origin (for internal detection).
 */
export function parseReferrer(referrer: unknown, siteOrigin: string): { domain: string | null } {
  if (!referrer || typeof referrer !== "string") {
    return { domain: null };
  }
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return { domain: null };
  }

  let siteHost: string | null = null;
  if (siteOrigin) {
    try {
      siteHost = new URL(siteOrigin).hostname;
    } catch {
      siteHost = null;
    }
  }

  const domain = siteHost && url.hostname === siteHost ? "(internal)" : url.hostname;
  return { domain };
}
