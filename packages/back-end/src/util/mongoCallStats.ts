import { AsyncLocalStorage } from "async_hooks";
import { IncomingMessage } from "http";
import { performance } from "perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { Server } from "mongodb/lib/sdam/server";

export class MongoCallStats {
  private calls = 0;
  private outstanding = 0;
  private busySince = 0;
  private busyMs = 0;
  private longestChain = 0;
  private longestEndedChain = 0;

  start(now: number): number {
    this.calls++;
    if (this.outstanding === 0) this.busySince = now;
    this.outstanding++;
    const chain = this.longestEndedChain + 1;
    this.longestChain = Math.max(this.longestChain, chain);
    return chain;
  }

  end(chain: number, now: number) {
    this.longestEndedChain = Math.max(this.longestEndedChain, chain);
    this.outstanding--;
    if (this.outstanding === 0) this.busyMs += now - this.busySince;
  }

  summary(now: number) {
    const wallMs =
      this.busyMs + (this.outstanding > 0 ? now - this.busySince : 0);
    return {
      calls: this.calls,
      sequential: this.longestChain,
      wallMs: Math.round(wallMs * 100) / 100,
    };
  }
}

const storage = new AsyncLocalStorage<MongoCallStats>();
const statsByRequest = new WeakMap<IncomingMessage, MongoCallStats>();

export function countMongoCalls(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const stats = new MongoCallStats();
  statsByRequest.set(req, stats);
  storage.run(stats, next);
}

export function getMongoCallSummary(req: IncomingMessage) {
  return statsByRequest.get(req)?.summary(performance.now());
}

// The driver's public command monitoring events fire after a connection is
// checked out of the pool, from whichever async context drained the pool's
// wait queue, so they can't be attributed to the request that issued them.
// Server#command is still called synchronously from the caller's context.
let installed = false;
export function installMongoCallCounter() {
  if (installed) return;
  installed = true;
  const original = Server.prototype.command;
  Server.prototype.command = function (ns, cmd, options, callback) {
    const stats = storage.getStore();
    if (!stats) return original.call(this, ns, cmd, options, callback);
    const chain = stats.start(performance.now());
    return original.call(this, ns, cmd, options, (...args) => {
      stats.end(chain, performance.now());
      callback(...args);
    });
  };
}
