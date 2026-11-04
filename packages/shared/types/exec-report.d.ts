import type { z } from "zod";
import type { execReportValidator } from "shared/validators";

export type ExecReportInterface = z.infer<typeof execReportValidator>;
