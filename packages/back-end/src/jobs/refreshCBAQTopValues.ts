import Agenda, { Job } from "agenda";
import { ContextualBanditQueryInterface } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "refreshCBAQTopValues";
const SCHEDULE = "1 week";

const MAX_STRING_TOP_VALUES = 10;
const NUMERIC_BUCKETS = 4;
const SAMPLE_LIMIT = 100_000;

type RefreshCBAQTopValuesJob = Job<{
  organization: string;
  cbaqId: string;
}>;

const refreshCBAQTopValues = async (job: RefreshCBAQTopValuesJob) => {
  const { organization, cbaqId } = job.attrs.data;
  if (!organization || !cbaqId) return;

  let context;
  try {
    context = await getContextForAgendaJobByOrgId(organization);
  } catch (e) {
    logger.error(e, "refreshCBAQTopValues: failed to load org context");
    return;
  }

  const cbaq = await context.models.contextualBanditQueries.getById(cbaqId);
  if (!cbaq) return;

  const datasource = await getDataSourceById(context, cbaq.datasource);
  if (!datasource) return;

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.runTestQuery) return;

  const activeAttrs = cbaq.attributes.filter((a) => !a.deleted);
  if (activeAttrs.length === 0) return;

  // Pull a sample of the CBAQ's source rows so we can compute popular values
  // without round-tripping a query per attribute.
  let rows: Record<string, unknown>[] = [];
  try {
    const sampleSql = wrapWithLimit(cbaq.sql, SAMPLE_LIMIT);
    const result = await integration.runTestQuery(
      sampleSql,
      [],
      "cbaqTopValues",
    );
    rows = result.results;
  } catch (e) {
    logger.error(e, "refreshCBAQTopValues: failed to run sample query", {
      cbaqId,
    });
    return;
  }

  const updatedAttributes = activeAttrs.map((attr) => {
    if (attr.datatype === "string") {
      return {
        ...attr,
        topValues: computeTopStringValues(rows, attr.column),
        topValuesDate: new Date(),
        dateUpdated: new Date(),
      };
    }
    // numeric — store quantile bucket labels for SDK reference, even though
    // the actual bucketing is done in SQL via NTILE.
    return {
      ...attr,
      topValues: computeNumericQuantileLabels(rows, attr.column, NUMERIC_BUCKETS),
      topValuesDate: new Date(),
      dateUpdated: new Date(),
    };
  });

  // Preserve any deleted attrs (we only refresh active ones)
  const allAttributes = cbaq.attributes.map((a) => {
    const fresh = updatedAttributes.find((u) => u.column === a.column);
    return fresh ?? a;
  });

  await context.models.contextualBanditQueries.update(cbaq, {
    attributes: allAttributes,
  });
};

function wrapWithLimit(sql: string, limit: number): string {
  return `SELECT * FROM (\n${sql}\n) cbaq_src LIMIT ${limit}`;
}

export function computeTopStringValues(
  rows: Record<string, unknown>[],
  column: string,
  topN: number = MAX_STRING_TOP_VALUES,
): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row[column];
    if (v === null || v === undefined || v === "") continue;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
  const top = sorted.slice(0, topN).map(([v]) => v);
  // The literal "other" is appended so consumers that want a stable list of
  // dimension levels (e.g., the SDK payload builder) can rely on it.
  return [...top, "other"];
}

export function computeNumericQuantileLabels(
  rows: Record<string, unknown>[],
  column: string,
  buckets: number = NUMERIC_BUCKETS,
): string[] {
  const values = rows
    .map((r) => r[column])
    .filter((v): v is number | string => v !== null && v !== undefined && v !== "")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (values.length === 0) return ["other"];
  const labels: string[] = [];
  for (let i = 0; i < buckets; i++) labels.push(`q${i}`);
  return [...labels, "other"];
}

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(JOB_NAME, refreshCBAQTopValues);
}

/** Schedule the periodic refresh for a CBAQ. */
export async function scheduleCBAQTopValuesRefresh(
  cbaq: Pick<ContextualBanditQueryInterface, "id" | "organization">,
) {
  if (!agenda) return;
  const job = agenda.create(JOB_NAME, {
    organization: cbaq.organization,
    cbaqId: cbaq.id,
  }) as RefreshCBAQTopValuesJob;
  job.unique({ organization: cbaq.organization, cbaqId: cbaq.id });
  job.repeatEvery(SCHEDULE, { skipImmediate: false });
  await job.save();
}

/** Trigger an immediate refresh (e.g., after a datasource swap). */
export async function queueCBAQTopValuesRefreshNow(
  cbaq: Pick<ContextualBanditQueryInterface, "id" | "organization">,
) {
  if (!agenda) return;
  const job = agenda.create(JOB_NAME, {
    organization: cbaq.organization,
    cbaqId: cbaq.id,
  }) as RefreshCBAQTopValuesJob;
  job.unique({ organization: cbaq.organization, cbaqId: cbaq.id });
  job.schedule(new Date());
  await job.save();
}
