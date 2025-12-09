import { z } from "zod";
import { execReportValidator } from "back-end/src/routers/exec-report/exec-report.validators";

export type ExecReportInterface = z.infer<typeof execReportValidator>;
