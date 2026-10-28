import { AsyncLocalStorage } from "async_hooks";
import { IncomingMessage } from "http";
import { performance } from "perf_hooks";
import type { NextFunction, Request, Response } from "express";

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

type CommandCallback = (...args: unknown[]) => void;
type ServerCommand = (
  this: unknown,
  ns: unknown,
  cmd: unknown,
  options: unknown,
  callback?: CommandCallback,
) => unknown;

// The driver's public command monitoring events fire after a connection is
// checked out of the pool, from whichever async context drained the pool's
// wait queue, so they can't be attributed to the request that issued them.
// Server#command is still called synchronously from the caller's context.
// Returns false, leaving the prototype untouched, when the driver's internal
// method doesn't have the 4.x callback signature this wraps.
const wrapped = new WeakSet<object>();
export function wrapServerCommand(proto: { command?: unknown }): boolean {
  if (wrapped.has(proto)) return true;
  const original = proto.command;
  if (typeof original !== "function" || original.length !== 4) return false;
  const command = original as ServerCommand;
  wrapped.add(proto);
  proto.command = function (
    this: unknown,
    ns: unknown,
    cmd: unknown,
    options: unknown,
    callback?: CommandCallback,
  ) {
    const stats = storage.getStore();
    if (!stats || typeof callback !== "function") {
      return command.call(this, ns, cmd, options, callback);
    }
    let chain: number;
    try {
      chain = stats.start(performance.now());
    } catch {
      return command.call(this, ns, cmd, options, callback);
    }
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      try {
        stats.end(chain, performance.now());
      } catch {
        // Stats must never break a database call
      }
    };
    try {
      return command.call(this, ns, cmd, options, (...args: unknown[]) => {
        end();
        callback(...args);
      });
    } catch (e) {
      end();
      throw e;
    }
  };
  return true;
}

export async function installMongoCallCounter(): Promise<boolean> {
  try {
    const { Server } = await import("mongodb/lib/sdam/server");
    return wrapServerCommand(Server.prototype);
  } catch {
    return false;
  }
}
