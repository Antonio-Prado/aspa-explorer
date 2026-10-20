// The subscriptions and the state of the poller, in a small SQLite file (node:sqlite).
import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('email', 'webhook')),
      target TEXT NOT NULL,
      asn TEXT NOT NULL,
      secret TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
      created INTEGER NOT NULL,
      attempted INTEGER NOT NULL,
      confirmed INTEGER,
      last_sent INTEGER,
      fails INTEGER NOT NULL DEFAULT 0,
      UNIQUE (kind, target, asn)
    );
    CREATE INDEX IF NOT EXISTS subs_asn ON subscriptions (asn, status);
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      created INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_created ON reports (created);
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_id INTEGER NOT NULL,
      job TEXT NOT NULL,
      created INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_try, id);
  `);
  // 1.19.0: a subscription can ask for the places of valley that involve its AS as well (older files do not have the column)
  if (!db.prepare('PRAGMA table_info(subscriptions)').all().some((c) => c.name === 'leaks')) db.exec('ALTER TABLE subscriptions ADD COLUMN leaks INTEGER NOT NULL DEFAULT 0');
  // 1.38.0: a subscription can ask to be told when its AS is the origin of that many invalid announcements in ten minutes (0: no)
  if (!db.prepare('PRAGMA table_info(subscriptions)').all().some((c) => c.name === 'invalid_min')) db.exec('ALTER TABLE subscriptions ADD COLUMN invalid_min INTEGER NOT NULL DEFAULT 0');
  const q = {
    find: db.prepare('SELECT * FROM subscriptions WHERE kind = ? AND target = ? AND asn = ?'),
    byId: db.prepare('SELECT * FROM subscriptions WHERE id = ?'),
    insert: db.prepare('INSERT INTO subscriptions (kind, target, asn, secret, status, created, attempted, leaks, invalid_min) VALUES (?, ?, ?, ?, \'pending\', ?, ?, ?, ?)'),
    setInvalid: db.prepare('UPDATE subscriptions SET invalid_min = ? WHERE id = ? AND status = \'pending\''),
    setLeaks: db.prepare('UPDATE subscriptions SET leaks = ? WHERE id = ? AND status = \'pending\''),
    attempt: db.prepare('UPDATE subscriptions SET attempted = ?, secret = COALESCE(?, secret) WHERE id = ?'),
    activate: db.prepare('UPDATE subscriptions SET status = \'active\', confirmed = ?, fails = 0 WHERE id = ?'),
    remove: db.prepare('DELETE FROM subscriptions WHERE id = ?'),
    active: db.prepare('SELECT * FROM subscriptions WHERE status = \'active\' AND asn = ?'),
    allActive: db.prepare('SELECT * FROM subscriptions WHERE status = \'active\''),
    sent: db.prepare('UPDATE subscriptions SET last_sent = ?, fails = 0 WHERE id = ?'),
    failed: db.prepare('UPDATE subscriptions SET fails = fails + 1 WHERE id = ?'),
    disable: db.prepare('UPDATE subscriptions SET status = \'disabled\' WHERE id = ?'),
    purge: db.prepare('DELETE FROM subscriptions WHERE status = \'pending\' AND attempted < ?'),
    perTarget: db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE kind = ? AND target = ?'),
    // the limit of an AS is on the subscriptions that are working: the ones that nobody has confirmed (and are deleted after two days) must not fill it
    perAsn: db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE asn = ? AND status = \'active\''),
    pendingAsn: db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE asn = ? AND status = \'pending\''),
    pendingAll: db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE status = \'pending\''),
    repend: db.prepare('UPDATE subscriptions SET status = \'pending\', fails = 0 WHERE id = ? AND status = \'disabled\''),
    counts: db.prepare('SELECT kind, status, COUNT(*) AS n FROM subscriptions GROUP BY kind, status'),
    addReport: db.prepare('INSERT INTO reports (id, created, kind, title, body) VALUES (?, ?, ?, ?, ?)'),
    getReport: db.prepare('SELECT id, created, kind, title, body FROM reports WHERE id = ?'),
    purgeReports: db.prepare('DELETE FROM reports WHERE created < ?'),
    countReports: db.prepare('SELECT COUNT(*) AS n FROM reports'),
    outboxAdd: db.prepare('INSERT INTO outbox (sub_id, job, created, next_try) VALUES (?, ?, ?, ?)'),
    // the subscriptions whose OLDEST message is due, with all their messages: a new message never goes before an older one that is waiting to be tried again
    outboxDue: db.prepare('SELECT o.* FROM outbox o WHERE o.sub_id IN (SELECT h.sub_id FROM outbox h WHERE h.id = (SELECT MIN(id) FROM outbox WHERE sub_id = h.sub_id) AND h.next_try <= ?) ORDER BY o.id'),
    outboxOldest: db.prepare('SELECT MIN(created) AS t FROM outbox'),
    disabledCount: db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE status = \'disabled\''),
    outboxDone: db.prepare('DELETE FROM outbox WHERE id = ?'),
    outboxRetry: db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?'),
    outboxWait: db.prepare('UPDATE outbox SET next_try = ? WHERE sub_id = ?'),
    outboxDropSub: db.prepare('DELETE FROM outbox WHERE sub_id = ?'),
    outboxCount: db.prepare('SELECT COUNT(*) AS n FROM outbox'),
    reportBytes: db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) AS n FROM reports'),
    getState: db.prepare('SELECT value FROM state WHERE key = ?'),
    setState: db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  };
  const plain = (r) => (r ? { ...r } : null);
  return {
    find: (kind, target, asn) => plain(q.find.get(kind, target, asn)),
    get: (id) => plain(q.byId.get(id)),
    insert: (kind, target, asn, secret, now, leaks = 0, invalid = 0) => Number(q.insert.run(kind, target, asn, secret, now, now, leaks ? 1 : 0, invalid).lastInsertRowid),
    setInvalid: (id, invalid) => q.setInvalid.run(invalid, id),
    setLeaks: (id, leaks) => q.setLeaks.run(leaks ? 1 : 0, id),
    attempt: (id, now, secret = null) => q.attempt.run(now, secret, id),
    activate: (id, now) => q.activate.run(now, id),
    remove: (id) => q.remove.run(id),
    active: (asn) => q.active.all(asn).map(plain),
    allActive: () => q.allActive.all().map(plain),
    sent: (id, now) => q.sent.run(now, id),
    failed: (id) => q.failed.run(id),
    disable: (id) => q.disable.run(id),
    purge: (olderThan) => Number(q.purge.run(olderThan).changes),
    countTarget: (kind, target) => q.perTarget.get(kind, target).n,
    countAsn: (asn) => q.perAsn.get(asn).n,
    countPendingAsn: (asn) => q.pendingAsn.get(asn).n,
    countPending: () => q.pendingAll.get().n,
    repend: (id) => q.repend.run(id),
    counts: () => q.counts.all().map(plain),
    addReport: (id, now, kind, title, body) => q.addReport.run(id, now, kind, title, body),
    getReport: (id) => { const r = q.getReport.get(id); return r ? { ...r, body: JSON.parse(r.body) } : null; },
    purgeReports: (olderThan) => Number(q.purgeReports.run(olderThan).changes),
    countReports: () => q.countReports.get().n,
    // bytes, not characters: LENGTH() of a TEXT value counts the characters, and an emoji is one of them and four bytes
    outboxAdd: (subId, job, now) => Number(q.outboxAdd.run(subId, job, now, now).lastInsertRowid),
    outboxDue: (now) => q.outboxDue.all(now).map(plain),
    outboxDone: (id) => q.outboxDone.run(id),
    // a failure delays the whole queue of the subscription, so that the messages behind the one that failed do not overtake it
    outboxRetry: (id, subId, nextTry) => { q.outboxRetry.run(id); q.outboxWait.run(nextTry, subId); },
    outboxDropSub: (subId) => q.outboxDropSub.run(subId),
    outboxCount: () => q.outboxCount.get().n,
    outboxOldest: () => q.outboxOldest.get().t,
    countDisabled: () => q.disabledCount.get().n,
    reportBytes: () => Number(q.reportBytes.get().n),
    getState: (key) => { const r = q.getState.get(key); return r ? JSON.parse(r.value) : null; },
    setState: (key, value) => q.setState.run(key, JSON.stringify(value)),
    close: () => db.close(),
  };
}
