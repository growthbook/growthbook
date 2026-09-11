import Agenda, { AgendaConfig, DefineOptions, Processor } from "agenda";
import mongoose from "mongoose";
import {
  EVENT_QUEUE_CONFIG,
  GB_AGENDA_DEFAULT_LOCK_LIMIT,
} from "back-end/src/util/secrets";
import { trackJob } from "./tracing";
import { addJobLifecycleChecks } from "./jobLifecycle";

let agendaInstance: Agenda;
let eventAgendaInstance: Agenda;

const createAgendaInstance = (options: AgendaConfig = {}): Agenda => {
  const config: AgendaConfig = {
    mongo: mongoose.connection.db,
    defaultLockLimit: GB_AGENDA_DEFAULT_LOCK_LIMIT,
    defaultLockLifetime: 10 * 60 * 1000, // 10 minutes
    ...options,
  };

  const agendaInstance = new Agenda(config);
  const originalDefine = agendaInstance.define;

  agendaInstance.define = function <T>(
    this: Agenda,
    name: string,
    options: DefineOptions | Processor<T>,
    processor?: Processor<T>,
  ): void {
    if (!processor) {
      processor = options as Processor<T>;
      options = {};
    }

    originalDefine.call(
      this,
      name,
      options as DefineOptions | Processor<unknown>,
      // @ts-expect-error Agenda's Processor<T> is incompatible with Processor<JobAttributesData> - T may not extend JobAttributesData
      trackJob(name, addJobLifecycleChecks(processor)),
    );
  };
  return agendaInstance;
};

export const getAgendaInstance = (): Agenda => {
  agendaInstance ??= createAgendaInstance();
  return agendaInstance;
};

export const getEventAgendaInstance = (): Agenda => {
  // Separate polling and execution capacity from long-running background jobs.
  eventAgendaInstance ??= createAgendaInstance({
    processEvery: `${EVENT_QUEUE_CONFIG.processEvery / 1000} seconds`,
    maxConcurrency:
      EVENT_QUEUE_CONFIG.eventCreated.concurrency +
      EVENT_QUEUE_CONFIG.eventWebHook.concurrency,
  });
  return eventAgendaInstance;
};
