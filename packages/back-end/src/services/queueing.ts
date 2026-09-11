import Agenda, { AgendaConfig, DefineOptions, Processor } from "agenda";
import mongoose from "mongoose";
import { parseEnvInt } from "shared/util";
import { trackJob } from "./tracing";
import { addJobLifecycleChecks, LOCK_LIFETIME_MS } from "./jobLifecycle";

let agendaInstance: Agenda;

export const getAgendaInstance = (): Agenda => {
  if (!agendaInstance) {
    const config: AgendaConfig = {
      mongo: mongoose.connection.db,
      defaultLockLimit: parseEnvInt(
        process.env.GB_AGENDA_DEFAULT_LOCK_LIMIT,
        5,
        { min: 1, name: "GB_AGENDA_DEFAULT_LOCK_LIMIT" },
      ),
      defaultLockLifetime: LOCK_LIFETIME_MS,
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
