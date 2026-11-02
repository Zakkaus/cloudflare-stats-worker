// The live dashboard allows exactly one viewer, so every request routes to a
// single fixed Durable Object instance rather than one keyed per session.
export function getRealtimeHub(env: Env) {
  if (!env.REALTIME) return null;
  return env.REALTIME.get(env.REALTIME.idFromName("global"));
}
