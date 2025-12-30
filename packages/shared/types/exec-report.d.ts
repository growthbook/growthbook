import { z } from "zod";
import { execReportValidator } from "shared/validators";

export type ExecReportInterface = z.infer<typeof execReportValidator>;
