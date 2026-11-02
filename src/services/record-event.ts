// The ingest write: resolve the ten dimension ids, then insert one events_tab row.
// Floor cost is 4 written rows per pageview (the row + its three indexes); every
// dimension lookup on the hit path is a read.
import { eventsTab } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import type { ParsedUserAgent } from "../ua.ts";
import { getDimId } from "./dims.ts";

export interface EventInput {
  day: number;
  visitorId: number;
  path: string;
  ref: { domain: string | null };
  country: string;
  ua: ParsedUserAgent;
}

export async function recordEvent(db: Db, e: EventInput): Promise<void> {
  const [
    pathId,
    refDomainId,
    countryId,
    browserId,
    browserVerId,
    osId,
    osVerId,
    deviceTypeId,
    deviceVendorId,
    deviceModelId,
  ] = await Promise.all([
    getDimId(db, "path", e.path),
    getDimId(db, "referrer_domain", e.ref.domain),
    getDimId(db, "country", e.country),
    getDimId(db, "browser", e.ua.browser.name),
    getDimId(db, "browser_version", e.ua.browser.version),
    getDimId(db, "os", e.ua.os.name),
    getDimId(db, "os_version", e.ua.os.version),
    getDimId(db, "device_type", e.ua.device.type),
    getDimId(db, "device_vendor", e.ua.device.vendor),
    getDimId(db, "device_model", e.ua.device.model),
  ]);

  await db.insert(eventsTab).values({
    day: e.day,
    visitorId: e.visitorId,
    // path is never empty (normalizePath), so its id is never null.
    pathId: pathId as number,
    refDomainId,
    countryId,
    browserId,
    browserVerId,
    osId,
    osVerId,
    deviceTypeId,
    deviceVendorId,
    deviceModelId,
  });
}
