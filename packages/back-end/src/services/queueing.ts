import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";

let agendaInstance: Agenda;

export const getAgendaInstance = (): Agenda => {
  if (!agendaInstance) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - Unable to determine the type because the union type for database options.
    const config: AgendaConfig = {
      mongo: mongoose.connection.db,
      defaultLockLimit: 5,
    };

    agendaInstance = new Agenda(config);
  }

  return agendaInstance;
};
