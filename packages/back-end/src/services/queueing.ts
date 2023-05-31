import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";

let agendaInstance: Agenda;

export const getAgendaInstance = (): Agenda => {
  if (!agendaInstance) {
    // @ts-expect-error - Type instantiation is excessively deep and possibly infinite.ts(2589)
    const config: AgendaConfig = {
      // @ts-expect-error - For some reason the Mongoose MongoDB instance does not match (missing 5 properties)
      mongo: mongoose.connection.db,
      defaultLockLimit: 5,
    };

    agendaInstance = new Agenda(config);
  }

  return agendaInstance;
};
