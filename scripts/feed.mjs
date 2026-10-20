// The Atom feed of the recent changes (changes.atom on the history branch), one entry for each day. The id of an entry is the day, so that it stays the same;
// its <updated> is the moment when the content of that day last changed: an entry that is rebuilt with the same content keeps the time it had, one that has
// new changes gets the time of the run, so that a reader that goes by id and updated sees the changes that arrive during the day.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// What a feed that was published before says: {day: {updated, content}} (the content as it is written in the file).
export function readFeed(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const id = /<id>tag:[^,]+,(\d{4}-\d{2}-\d{2}):changes<\/id>/.exec(m[0]);
    const updated = /<updated>([^<]+)<\/updated>/.exec(m[0]);
    const content = /<content type="html">([\s\S]*?)<\/content>/.exec(m[0]);
    if (id && updated && content) out[id[1]] = { updated: updated[1], content: content[1] };
  }
  return out;
}

// events: the list of the history; classify: site/history.js; old: the text of the feed that is published now (or null); now: a Date.
export function atomFeed(events, { site, classify, old = null, now = new Date() }) {
  const kinds = classify(events);
  const days = [...new Set(kinds.map((e) => e.date))].sort().reverse().slice(0, 30);
  const before = readFeed(old);
  const stamps = [];
  const entries = days.map((d) => {
    const ev = kinds.filter((e) => e.date === d);
    const n = (k) => ev.filter((e) => e.kind === k).length;
    const what = (e) => (e.kind === 'new' ? `new, providers ${e.providers.join(', ')}`
      : e.kind === 'removed' ? 'removed'
        : `providers ${[...e.added.map((p) => `+${p}`), ...e.dropped.map((p) => `-${p}`)].join(' ')}`);
    const items = ev.slice(0, 200).map((e) => `<li><a href="${site}/#${e.customer}">${e.customer}</a>: ${esc(what(e))}</li>`).join('');
    const more = ev.length > 200 ? `<p>and ${ev.length - 200} more</p>` : '';
    const content = esc(`<ul>${items}</ul>${more}`);
    const was = before[d];
    const updated = was && was.content === content ? was.updated : (old ? now.toISOString() : `${d}T06:30:00Z`);
    stamps.push(updated);
    return `  <entry>
    <id>tag:aspa.ping6.it,${d}:changes</id>
    <title>${d}: ${n('new')} new, ${n('removed')} removed, ${n('changed')} changed</title>
    <updated>${updated}</updated>
    <link rel="alternate" href="${site}/"/>
    <content type="html">${content}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:aspa.ping6.it,2026:changes</id>
  <title>ASPA Explorer: changes</title>
  <subtitle>ASPAs that appeared, changed their providers or disappeared, day by day</subtitle>
  <link rel="self" href="${site}/changes.atom"/>
  <link rel="alternate" href="${site}/"/>
  <updated>${stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : now.toISOString()}</updated>
${entries.join('\n')}
</feed>
`;
}
