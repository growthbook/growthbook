// Stand-in worker that fails on boot before sending its "ready" handshake, to
// exercise the pool's crash-loop breaker. Exits immediately on every spawn.
process.exit(1);
