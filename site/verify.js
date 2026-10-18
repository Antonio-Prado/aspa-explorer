'use strict';

// ASPA AS-path verification: the upstream and downstream procedures of
// draft-ietf-sidrops-aspa-verification, as pure functions over a lookup of ASPA records.
//
// Conventions
//  - An ASPA lookup is a Map from a customer ("AS680") to the Set of its providers
//    ("AS1299", ...). "AS0" in a set means "no transit providers" (an AS0 ASPA, in the wording of the IETF drafts).
//  - A path is an array of "AS<number>" ordered from the origin to the neighbour the
//    route was received from: A(1) is the origin and A(N) the neighbour, as in the
//    draft. BGP shows paths the other way round (neighbour first); parsePath() takes
//    care of that.
(function (root) {
  const PROVIDER = 'Provider+';
  const NOT_PROVIDER = 'Not Provider+';
  const NO_ATTESTATION = 'No Attestation';

  // hop(X, Y): does the ASPA published by X list Y as one of its providers?
  function hop(aspas, customer, provider) {
    const providers = aspas.get(customer);
    if (!providers) return NO_ATTESTATION;
    return providers.has(provider) ? PROVIDER : NOT_PROVIDER;
  }

  // Remove repeated adjacent ASes (AS-path prepending).
  function compress(path) {
    return path.filter((as, i) => i === 0 || as !== path[i - 1]);
  }

  // direction: 'up' when the route comes from a customer or a peer, 'down' when it
  // comes from a provider. Returns the verdict and everything needed to explain it.
  function verify(aspas, rawPath, direction) {
    const path = compress(rawPath);
    const N = path.length;
    // up[i] = hop(A(i), A(i+1)), i = 1..N-1 (the customer->provider check, going up)
    // down[j] = hop(A(j), A(j-1)), j = 2..N (the same check read from the neighbour side)
    const up = new Array(N + 1);
    const down = new Array(N + 1);
    for (let i = 1; i <= N - 1; i++) up[i] = hop(aspas, path[i - 1], path[i]);
    for (let j = 2; j <= N; j++) down[j] = hop(aspas, path[j - 1], path[j - 2]);

    // Up-ramp: the part of the path, from the origin, that climbs customer -> provider.
    // maxUp stops at the first hop attested as NOT a provider, minUp at the first hop
    // that is not attested as a provider (a missing ASPA also stops it).
    let maxUp = N;
    let minUp = N;
    for (let i = 1; i <= N - 1; i++) if (up[i] === NOT_PROVIDER) { maxUp = i; break; }
    for (let i = 1; i <= N - 1; i++) if (up[i] !== PROVIDER) { minUp = i; break; }

    // Down-ramp: the same, from the neighbour side going towards the origin.
    let maxDown = N;
    let minDown = N;
    for (let j = N; j >= 2; j--) if (down[j] === NOT_PROVIDER) { maxDown = N - j + 1; break; }
    for (let j = N; j >= 2; j--) if (down[j] !== PROVIDER) { minDown = N - j + 1; break; }

    let result;
    if (N <= 1) result = 'Valid';
    else if (direction === 'up') {
      if (maxUp < N) result = 'Invalid';
      else if (minUp < N) result = 'Unknown';
      else result = 'Valid';
    } else {
      if (maxUp + maxDown < N) result = 'Invalid';
      else if (minUp + minDown < N) result = 'Unknown';
      else result = 'Valid';
    }
    return { result, direction, path, N, up, down, maxUp, minUp, maxDown, minDown };
  }

  // Parse a path as routers print it (neighbour first, origin last). Accepts "AS3356 1299
  // AS680", with spaces or commas. Returns { path } (origin first) or { error }.
  function parsePath(text) {
    const s = String(text).trim();
    if (!s) return { error: 'Enter an AS path, for example 3356 1299 680.' };
    if (/[{}()[\]]/.test(s)) {
      return { error: 'The path contains an AS_SET or a confederation segment. The ASPA procedure treats such paths as Invalid, and this page only checks plain AS sequences.', asSet: true };
    }
    const tokens = s.split(/[\s,]+/).filter(Boolean);
    const path = [];
    for (const t of tokens) {
      const m = t.match(/^(?:as)?(\d{1,10})$/i);
      if (!m || Number(m[1]) > 4294967295) return { error: `"${t}" is not an AS number. Use plain numbers such as 3356 or AS3356, separated by spaces.` };
      path.push('AS' + Number(m[1]));
    }
    return { path: path.reverse() };
  }

  const api = { hop, compress, verify, parsePath, PROVIDER, NOT_PROVIDER, NO_ATTESTATION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AspaVerify = api;
})(typeof self !== 'undefined' ? self : this);
