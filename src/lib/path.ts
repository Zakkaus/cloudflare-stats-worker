// Path normalization: full URLs -> pathname; strip query/hash, index files,
// language prefixes; enforce a single leading + trailing slash.
export function normalizePath(input: unknown): string {
  if (!input) return "/";
  let raw = `${input}`.trim();
  if (!raw) return "/";
  if (raw.startsWith("//")) raw = `https:${raw}`;

  let pathSource = raw;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      pathSource = new URL(raw).pathname || "/";
    } else if (/^[a-z][a-z0-9+.-]*:\/[^/]/i.test(raw)) {
      pathSource = new URL(raw.replace(/^([a-z][a-z0-9+.-]*:\/)([^/])/i, "$1/$2")).pathname || "/";
    }
  } catch {
    // fall back to raw
  }

  let path = pathSource.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+/g, "/");
  path = path.replace(/\/index\.html?$/i, "/");
  path = path.replace(/\/index$/i, "/");
  path = path.replace(/\/_index$/i, "/");

  const langPrefix = path.match(/^\/(zh-cn|zh-tw|en)(\/.*)?$/i);
  if (langPrefix) {
    path = langPrefix[2] || "/";
    if (!path.startsWith("/")) path = `/${path}`;
  }

  if (path !== "/" && !path.endsWith("/")) path = `${path}/`;
  return path;
}
