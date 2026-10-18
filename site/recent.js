'use strict';

// The checks that this browser made lately (an AS looked up, a path checked), kept in its own storage and nowhere else, so that coming back shows what
// changed since: the providers that an AS added or dropped, a path whose verdict moved. Pure functions over a list; the page reads and writes the storage.
(function (root) {
  const KEY = 'aspa-recent';
  const MAX = 20;
  const DAY = 86400e3;

  // An entry is {kind: 'as', id: 'AS680', t, providers: [...], named: n} or {kind: 'path', id: '3356 1299 680', direction, t, result}.
  // Anything stored that does not look like that is dropped: the storage can hold whatever an older version or somebody else put there.
  function clean(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.t !== 'number' || typeof e.id !== 'string' || e.id.length > 200) continue;
      if (e.kind === 'as' && /^AS[1-9]\d{0,9}$/.test(e.id) && Array.isArray(e.providers) && e.providers.every((p) => /^AS\d{1,10}$/.test(p)) && Number.isInteger(e.named)) out.push({ kind: 'as', id: e.id, t: e.t, providers: e.providers.slice(0, 500), named: e.named });
      else if (e.kind === 'path' && (e.direction === 'up' || e.direction === 'down') && ['Valid', 'Unknown', 'Invalid'].includes(e.result) && /^[0-9 AS]+$/i.test(e.id)) out.push({ kind: 'path', id: e.id, direction: e.direction, t: e.t, result: e.result });
    }
    return out.slice(0, MAX);
  }

  const same = (a, b) => a.kind === b.kind && a.id === b.id && (a.kind === 'as' || a.direction === b.direction);
  const find = (list, probe) => list.find((e) => same(e, probe)) || null;
  // the list with this entry first, and the older entry for the same thing out
  const record = (list, entry) => clean([entry, ...list.filter((e) => !same(e, entry))]);

  // What changed for an AS since the entry was made: now = {providers, named}. Returns {changed, text}.
  function diffAs(before, now) {
    const bs = new Set(before.providers), ns = new Set(now.providers);
    const added = now.providers.filter((p) => !bs.has(p)), dropped = before.providers.filter((p) => !ns.has(p));
    const bits = [];
    if (!before.providers.length && now.providers.length) bits.push(`it has published an ASPA, with ${now.providers.length} provider${now.providers.length === 1 ? '' : 's'}`);
    else if (before.providers.length && !now.providers.length) bits.push('its ASPA is gone');
    else {
      if (added.length) bits.push(`added ${added.slice(0, 6).join(', ')}${added.length > 6 ? ` and ${added.length - 6} more` : ''}`);
      if (dropped.length) bits.push(`dropped ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? ` and ${dropped.length - 6} more` : ''}`);
    }
    if (now.named !== before.named) bits.push(`named as a provider by ${Math.abs(now.named - before.named)} ${now.named > before.named ? 'more' : 'fewer'} ASPA${Math.abs(now.named - before.named) === 1 ? '' : 's'} (${before.named} before, ${now.named} now)`);
    return bits.length ? { changed: true, text: bits.join('; ') } : { changed: false, text: 'nothing has changed' };
  }

  const diffPath = (before, result) => (before.result === result ? { changed: false, text: `still ${result}` } : { changed: true, text: `it was ${before.result}, it is ${result} now` });

  // "3 days ago", "today", for the list
  function ago(t, now = Date.now()) {
    const d = Math.floor((now - t) / DAY);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  }

  const api = { KEY, MAX, clean, find, record, diffAs, diffPath, ago };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // the storage, where there is one (a private window or blocked site data can refuse it)
  const store = {
    load() { try { return clean(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } },
    save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* nothing to do */ } },
  };
  root.AspaRecent = { ...api, store };
})(typeof self !== 'undefined' ? self : this);
