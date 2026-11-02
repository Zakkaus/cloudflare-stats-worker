// Whitelist: dimension name -> { fact-table FK column, lookup table }.
// Both sides are trusted constants (never user input) so interpolating them
// into SQL is safe; all *values* are always bound parameters.
//
// Shared by the query API and the Parquet archive (archive.ts), whose column
// names are exactly these keys -- so a dashboard filter token maps 1:1 onto an
// archive column. Also imported by the Node scripts (they run .ts natively).
export const DIMENSIONS = {
  path: { col: "path_id", table: "dim_path_tab" },
  referrer_domain: { col: "ref_domain_id", table: "dim_ref_domain_tab" },
  country: { col: "country_id", table: "dim_country_tab" },
  browser: { col: "browser_id", table: "dim_browser_tab" },
  browser_version: { col: "browser_ver_id", table: "dim_browser_ver_tab" },
  os: { col: "os_id", table: "dim_os_tab" },
  os_version: { col: "os_ver_id", table: "dim_os_ver_tab" },
  device_type: { col: "device_type_id", table: "dim_device_type_tab" },
  device_vendor: { col: "device_vendor_id", table: "dim_device_vendor_tab" },
  device_model: { col: "device_model_id", table: "dim_device_model_tab" },
} as const;

export type DimensionName = keyof typeof DIMENSIONS;

// Own-property check: `name in DIMENSIONS` / `DIMENSIONS[name]` would also accept
// inherited keys such as "constructor".
export function isDimension(name: string): name is DimensionName {
  return Object.hasOwn(DIMENSIONS, name);
}

// How a missing dimension value (a NULL FK, or the 0 rollup sentinel) is labelled.
export function nullLabelFor(dimension: string): string {
  return dimension.startsWith("referrer") ? "(direct)" : "(unknown)";
}
