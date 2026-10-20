// Runs async jobs a few at a time, so that a few slow endpoints (a webhook may take its whole timeout) do not hold up everybody else.
// Every job is expected to deal with its own errors; one that throws anyway is logged by the caller through `onError` and does not stop the others.
export async function pool(jobs, limit = 8, onError = () => {}) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try { await job(); } catch (err) { onError(err); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}
