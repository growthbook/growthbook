import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";
import {
  AGENDA_DEFAULT_CONCURRENCY,
  AGENDA_DEFAULT_LOCK_LIMIT,
  AGENDA_LOCK_LIMIT,
  AGENDA_MAX_CONCURRENCY,
} from "../util/secrets";

let agendaInstance: Agenda;

export const getAgendaInstance = (): Agenda => {
  if (!agendaInstance) {
    // @ts-expect-error - Type instantiation is excessively deep and possibly infinite.ts(2589)
    const config: AgendaConfig = {
      // @ts-expect-error - For some reason the Mongoose MongoDB instance does not match (missing 5 properties)
      mongo: mongoose.connection.db,
      defaultLockLimit: AGENDA_DEFAULT_LOCK_LIMIT,
      lockLimit: AGENDA_LOCK_LIMIT,
      defaultConcurrency: AGENDA_DEFAULT_CONCURRENCY,
      maxConcurrency: AGENDA_MAX_CONCURRENCY,
    };

    agendaInstance = new Agenda(config);
  }

  return agendaInstance;
};
