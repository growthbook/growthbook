import type { Agenda, Job } from "agenda";
import type { Collection, MongoClient } from "mongodb";
import mongoose from "mongoose";
import { parseEnvInt } from "shared/util";
import { MONGODB_URI } from "back-end/src/util/secrets";
import { trackJob } from "./tracing";
import { addJobLifecycleChecks } from "./jobLifecycle";

type DefineOptions = {
  concurrency?: number;
  lockLimit?: number;
  lockLifetime?: number;
};

type Processor<T = unknown> = (job: Job<T>) => Promise<void>;

let agendaInstance: Agenda | undefined;
let agendaMongoClient: MongoClient | undefined;
let initPromise: Promise<Agenda> | undefined;

function getAgendaMongoUri(): string {
  if (process.env.NODE_ENV === "test") {
    return process.env.MONGO_URL || MONGODB_URI;
  }
  return MONGODB_URI;
}

function installDefineWrapper(agenda: Agenda): void {
  const originalDefine = agenda.define.bind(agenda);

  agenda.define = function defineWrapped<T>(
    name: string,
    optionsOrProcessor: DefineOptions | Processor<T>,
    processorOrOptions?: Processor<T> | DefineOptions,
  ): void {
    let processor: Processor<T>;
    let options: DefineOptions | undefined;

    // Accept v5 (name, options, processor) and v6 (name, processor, options).
    if (typeof optionsOrProcessor === "function") {
      processor = optionsOrProcessor;
      options = processorOrOptions as DefineOptions | undefined;
    } else if (typeof processorOrOptions === "function") {
      options = optionsOrProcessor;
      processor = processorOrOptions;
    } else {
      throw new Error(`agenda.define(${name}): processor function required`);
    }

    originalDefine(
      name,
      trackJob(name, addJobLifecycleChecks(processor)) as Processor<T>,
      options,
    );
  } as typeof agenda.define;
}

export async function initAgenda(): Promise<Agenda> {
  if (agendaInstance) {
    return agendaInstance;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const { Agenda } = await import("agenda");
    const { MongoBackend } = await import("@agendajs/mongo-backend");
    const { MongoClient } = await import("mongodb");

    if (!mongoose.connection.db) {
      throw new Error("initAgenda requires an established mongoose connection");
    }

    const uri = getAgendaMongoUri();
    const client = await MongoClient.connect(uri);
    agendaMongoClient = client;

    const dbName =
      mongoose.connection.db.databaseName || mongoose.connection.name;
    const db = client.db(dbName);

    const agenda = new Agenda({
      backend: new MongoBackend({
        mongo: db,
        collection: "agendaJobs",
      }),
      defaultLockLimit: parseEnvInt(
        process.env.GB_AGENDA_DEFAULT_LOCK_LIMIT,
        5,
        { min: 1, name: "GB_AGENDA_DEFAULT_LOCK_LIMIT" },
      ),
      defaultLockLifetime: 10 * 60 * 1000,
    });

    installDefineWrapper(agenda);
    await agenda.ready;
    agendaInstance = agenda;
    return agenda;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = undefined;
    if (agendaMongoClient) {
      await agendaMongoClient.close().catch(() => undefined);
      agendaMongoClient = undefined;
    }
    throw err;
  }
}

export function getAgendaInstance(): Agenda {
  if (!agendaInstance) {
    throw new Error(
      "Agenda has not been initialized. Call initAgenda() after mongoInit.",
    );
  }
  return agendaInstance;
}

export function getAgendaJobsCollection(agenda: Agenda): Collection {
  const repo = agenda.db as { collection: Collection };
  return repo.collection;
}

export async function stopAgenda(): Promise<void> {
  if (agendaInstance) {
    await agendaInstance.stop();
  }
  agendaInstance = undefined;
  initPromise = undefined;

  if (agendaMongoClient) {
    await agendaMongoClient.close();
    agendaMongoClient = undefined;
  }
}
