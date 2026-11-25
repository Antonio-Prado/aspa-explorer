// The two states of the ASPAs around a table dump of 00:00 UTC of a day, from the timeline of the ASPAs
// (scripts/aspa-timeline.mjs of the site, data/timeline.json here): the one known at that time (`stateBefore`), and the one
// after the steps that are open at that time, that is the changes that may or may not have been there at 00:00 (`stateFor`).
// For a day of the RIPE NCC archive they are the snapshot of the day before, some 19 hours older than the dump, and the one
// of the day itself, some 5 hours newer; for a day of the hourly job of the site they are one hour apart at most, or the same.
// A dump is read with both (dump-places.mjs, `before` and `day`), and robust.mjs keeps the places that are Invalid with both.
// The states are given as the history gives them: Map 'AS1' -> ['AS2', ...].
import { readFileSync } from 'node:fs';
import { Timeline } from '../../scripts/aspa-timeline.mjs';

const DATA = process.env.FP_DATA || new URL('./data/', import.meta.url).pathname;
let tl = null;
const timeline = () => (tl ||= new Timeline(JSON.parse(readFileSync(`${DATA}/timeline.json`, 'utf8'))));
const asHistory = (state) => new Map([...state].map(([c, p]) => [`AS${c}`, p.map((x) => `AS${x}`)]));
const midnight = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;

export const stateBefore = () => (iso) => { const t = midnight(iso), T = timeline(); return asHistory(T.raw(T.indexAt(t))); };
export const stateFor = () => (iso) => { const t = midnight(iso), T = timeline(), n = T.indexAt(t); return asHistory(T.raw(n + T.open(t, n))); };
