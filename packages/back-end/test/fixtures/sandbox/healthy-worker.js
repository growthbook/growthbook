// Minimal stand-in for sandbox-worker.js used by sandbox-pool integration tests.
// Implements the same IPC protocol: send a "ready" handshake on boot, then reply
// to each job with { id, result }, echoing args.n so the round-trip is verifiable.
if (!process.send) process.exit(0);
process.on("disconnect", () => process.exit(0));

process.send({ ready: true });

process.on("message", (job) => {
  process.send({
    id: job.id,
    result: {
      ok: true,
      returnVal: job.args ? job.args.n : null,
      log: "",
      warnings: [],
    },
  });
});
