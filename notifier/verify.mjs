// The verification of an AS path against the ASPAs of the moment, for GET /api/v1/verify: the same procedure as the page
// (site/verify.js), over the ASPAs that the notifier reads from the validator at every poll.
import { createRequire } from 'node:module';

const Verify = createRequire(import.meta.url)('../site/verify.js');

export const MAX_PATH = 64;          // ASes in a path, prepending included
export const MAX_TEXT = 1024;        // characters of the path as sent
const AS_RE = /^AS\d{1,10}$/;
const DIRECTIONS = { up: 'up', upstream: 'up', down: 'down', downstream: 'down' };

export function makeVerifier() {
  let sets = null, generated = null;

  // aspas: the list of Routinator's jsonext ({customer, providers}); the providers of a customer with more than one object are merged, as the page does
  function set(aspas, when) {
    const next = new Map();
    for (const a of aspas || []) {
      if (!a || typeof a.customer !== 'string' || !AS_RE.test(a.customer) || !Array.isArray(a.providers)) continue;
      const s = next.get(a.customer) || next.set(a.customer, new Set()).get(a.customer);
      for (const p of a.providers) if (typeof p === 'string' && AS_RE.test(p)) s.add(p);
    }
    sets = next;
    generated = when || null;
  }

  // params: the URLSearchParams of the request. Returns {status, body}.
  function check(params) {
    const bad = (error, status = 400) => ({ status, body: { error } });
    if (!sets) return bad('the ASPAs have not been read yet, try again in a minute', 503);
    const text = params.get('path');
    if (text === null || !text.trim()) return bad('give the AS path as routers print it, the neighbour first and the origin last: ?path=3356+1299+680');
    if (text.length > MAX_TEXT) return bad(`the path is too long (${MAX_TEXT} characters at most)`);
    const wanted = (params.get('direction') || 'upstream').toLowerCase();
    const direction = DIRECTIONS[wanted];
    if (!direction) return bad('direction must be "upstream" (the route comes from a customer or a peer; the default) or "downstream" (it comes from a provider)');
    const parsed = Verify.parsePath(text);
    if (parsed.asSet) return bad('the path contains an AS_SET or a confederation segment: the ASPA procedure treats such a path as Invalid, and this service checks plain AS sequences only');
    if (parsed.error) return bad('the path must be AS numbers such as 3356 or AS3356, separated by spaces or commas (AS0 cannot be in an AS path)');
    if (parsed.path.length > MAX_PATH) return bad(`the path is too long (${MAX_PATH} ASes at most)`);
    const v = Verify.verify(sets, parsed.path, direction);
    const hops = [];
    for (let i = 1; i <= v.N - 1; i++) {
      hops.push({ from: v.path[i - 1], to: v.path[i], from_lists_to: v.up[i], to_lists_from: v.down[i + 1] });
    }
    return {
      status: 200,
      body: {
        result: v.result,
        direction: direction === 'up' ? 'upstream' : 'downstream',
        as_path: v.path.slice().reverse(),
        origin: v.path[0],
        neighbour: v.path[v.N - 1],
        hops,
        ramps: { max_up: v.maxUp, min_up: v.minUp, max_down: v.maxDown, min_down: v.minDown },
        without_aspa: Verify.withoutAspa(sets, v),
        aspas: { generated, count: sets.size },
      },
    };
  }

  return { set, check, ready: () => Boolean(sets) };
}
