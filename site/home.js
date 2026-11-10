'use strict';

// The home page: a search that opens the page of an AS, three numbers, and the three areas of the site.
// Until 1.64 the tools were on this page, so the old addresses (/#AS680, /#path=…, /#routes=…, /#changes, /#quality)
// are sent where those things are now.
(function () {
  const h = location.hash.slice(1);
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };
  const asOf = (s) => {
    const m = String(s).trim().match(/^(?:as\s*)?(\d{1,10})$/i);
    return m && Number(m[1]) <= 4294967295 ? 'AS' + Number(m[1]) : null;
  };
  if (h) {
    let to = null;
    if (h.startsWith('path=') || h.startsWith('routes=')) to = `/network.html#${h}`;
    else if (h === 'changes' || h === 'quality') to = `/statistics.html#${h}`;
    else if (h === 'all') to = '/api.html#download';
    else if (asOf(dec(h))) to = `/as/${asOf(dec(h))}`;
    if (to) { location.replace(to); return; }
  }

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US');
  const getJson = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

  document.addEventListener('DOMContentLoaded', () => {
    $('home-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const as = asOf($('home-asn').value);
      if (!as) { $('home-error').textContent = 'Type an AS number, such as AS680 or 680.'; $('home-asn').focus(); return; }
      location.assign(`/as/${as}`);
    });

    // the count of the validator of the site (from the comparison of the validators, a small file) and the daily adoption numbers
    getJson('/api/v1/validators.json').then((d) => {
      const r = (d.sources || []).find((s) => s.id === 'routinator');
      if (r && Number.isFinite(r.count)) $('home-count').textContent = fmt.format(r.count);
    }).catch(() => { $('home-count').textContent = '–'; });
    getJson('/api/v1/adoption.json').then((d) => {
      if (Number.isFinite(d.pct) && d.seen) {
        $('home-share').textContent = `${d.pct.toFixed(1)}%`;
        $('home-share-note').textContent = `of the ${fmt.format(d.seen)} ASes seen in BGP`;
      }
      const top = Array.isArray(d.top_transit) ? d.top_transit.length : 0;
      if (top && Number.isFinite(d.top_transit_with_aspa)) $('home-transit').textContent = `${d.top_transit_with_aspa} of ${top}`;
    }).catch(() => { $('home-share').textContent = '–'; $('home-transit').textContent = '–'; });
  });
})();
