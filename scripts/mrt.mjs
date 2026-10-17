// A reader of MRT table dumps (TABLE_DUMP_V2, RFC 6396), as the RIPE RIS collectors publish them
// (https://data.ris.ripe.net/rrcNN/latest-bview.gz). It only reads what the leak job needs: for every
// route of every peer, the AS path. No dependencies.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

const TABLE_DUMP_V2 = 13;
const PEER_INDEX_TABLE = 1, RIB_IPV4_UNICAST = 2, RIB_IPV6_UNICAST = 4;
const MAX_PATH = 512;

// The AS numbers of an AS_PATH attribute (4-byte numbers) written into `out`; returns their count, or -1 when
// the path has anything but AS_SEQUENCE segments (an AS_SET, a confederation) or does not fit.
export function readAsPath(buf, pos, end, out) {
  let n = 0;
  while (pos + 2 <= end) {
    const type = buf[pos], count = buf[pos + 1];
    pos += 2;
    if (type !== 2 || pos + count * 4 > end || n + count > out.length) return -1;
    for (let i = 0; i < count; i++, pos += 4) out[n++] = buf.readUInt32BE(pos);
  }
  return n;
}

// Walk the path attributes of one RIB entry and read the AS_PATH. Returns the number of ASes, or -1.
export function pathOfAttributes(buf, pos, end, out) {
  while (pos + 3 <= end) {
    const flags = buf[pos], type = buf[pos + 1];
    let len, hdr;
    if (flags & 0x10) { len = buf.readUInt16BE(pos + 2); hdr = 4; } else { len = buf[pos + 2]; hdr = 3; }
    if (pos + hdr + len > end) return -1;
    if (type === 2) return readAsPath(buf, pos + hdr, pos + hdr + len, out);
    pos += hdr + len;
  }
  return -1;
}

// The peers of a PEER_INDEX_TABLE record: [{as, ip}]
export function readPeers(buf, pos, end) {
  pos += 4;                                           // collector BGP id
  pos += 2 + buf.readUInt16BE(pos);                   // view name
  const count = buf.readUInt16BE(pos); pos += 2;
  const peers = [];
  for (let i = 0; i < count && pos < end; i++) {
    const t = buf[pos]; pos += 1 + 4;                 // type and BGP id
    const v6 = (t & 1) !== 0, as4 = (t & 2) !== 0;
    pos += v6 ? 16 : 4;
    peers.push({ as: as4 ? buf.readUInt32BE(pos) : buf.readUInt16BE(pos) });
    pos += as4 ? 4 : 2;
  }
  return peers;
}

// Read a (gunzipped) MRT byte stream. onEntry(peerAs, path, length) is called for every route whose path is a plain
// AS_SEQUENCE; `path` is a buffer that is reused, so copy what you keep. Resolves with the counts.
export async function readRib(stream, onEntry) {
  const path = new Uint32Array(MAX_PATH);
  let carry = null, peers = [];
  const stats = { records: 0, entries: 0, skipped: 0 };
  const record = (buf, pos, len, type, subtype) => {
    stats.records++;
    if (type !== TABLE_DUMP_V2) return;
    const end = pos + len;
    if (subtype === PEER_INDEX_TABLE) { peers = readPeers(buf, pos, end); return; }
    if (subtype !== RIB_IPV4_UNICAST && subtype !== RIB_IPV6_UNICAST) return;
    pos += 4;                                         // sequence number
    const plen = buf[pos]; pos += 1 + Math.ceil(plen / 8);
    const count = buf.readUInt16BE(pos); pos += 2;
    for (let i = 0; i < count && pos + 8 <= end; i++) {
      const peer = buf.readUInt16BE(pos);
      const alen = buf.readUInt16BE(pos + 6);
      const n = pathOfAttributes(buf, pos + 8, pos + 8 + alen, path);
      pos += 8 + alen;
      if (n < 1) { stats.skipped++; continue; }
      stats.entries++;
      onEntry(peers[peer] ? peers[peer].as : 0, path, n);
    }
  };
  for await (let chunk of stream) {
    if (carry) { chunk = Buffer.concat([carry, chunk]); carry = null; }
    let pos = 0;
    while (chunk.length - pos >= 12) {
      const len = chunk.readUInt32BE(pos + 8);
      if (chunk.length - pos - 12 < len) break;
      record(chunk, pos + 12, len, chunk.readUInt16BE(pos + 4), chunk.readUInt16BE(pos + 6));
      pos += 12 + len;
    }
    if (pos < chunk.length) carry = chunk.subarray(pos);
  }
  return stats;
}

export const openGz = (file) => createReadStream(file).pipe(createGunzip({ chunkSize: 1 << 20 }));
