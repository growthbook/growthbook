import Agenda, { AgendaConfig, DefineOptions, Processor } from "agenda";
import mongoose from "mongoose";
import { trackJob } from "./tracing";
import { addJobLifecycleChecks } from "./jobLifecycle";

let agendaInstance: Agenda;

export const getAgendaInstance = (): Agenda => {
  if (!agendaInstance) {
    const config: AgendaConfig = {
      mongo: mongoose.connection.db,
      defaultLockLimit: Number(process.env.GB_AGENDA_DEFAULT_LOCK_LIMIT) || 5,
      defaultLockLifetime: 10 * 60 * 1000, // 10 minutes
    };

    agendaInstance = new Agenda(config);
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
  }

  return agendaInstance;
};
