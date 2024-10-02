import Agenda, { Job } from "agenda";
import { canInlineFilterColumn } from "shared/experiments";
import { getFactTable, updateColumn } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { ColumnInterface, FactTableInterface } from "back-end/types/fact-table";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { trackJob } from "back-end/src/services/otel";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/organization";
import { DataSourceInterface } from "back-end/types/datasource";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";

// Not used anywhere yet, but might be useful in the future
const JOB_NAME = "refreshFactTableTopValues";
type RefreshFactTableTopValuesJob = Job<{
  organization: string;
  factTableId: string;
  column: string;
}>;

export async function runColumnTopValuesQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName">,
  column: ColumnInterface
): Promise<string[]> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (
    !integration.getColumnTopValuesQuery ||
    !integration.runColumnTopValuesQuery
  ) {
    throw new Error("Top values not supported on this data source");
  }

  const sql = integration.getColumnTopValuesQuery({
    factTable,
    column,
    limit: 100,
  });

  const result = await integration.runColumnTopValuesQuery(sql);

  return result.rows.map((r) => r.value);
}

const refreshFactTableTopValues = trackJob(
  JOB_NAME,
  async (job: RefreshFactTableTopValuesJob) => {
    const { organization, factTableId, column: columnId } = job.attrs.data;

    if (!factTableId || !organization || !columnId) return;

    const context = await getContextForAgendaJobByOrgId(organization);

    const factTable = await getFactTable(context, factTableId);
    if (!factTable) return;

    const column = factTable.columns.find((c) => c.column === columnId);
    if (!column) return;

    if (
      !column.alwaysInlineFilter ||
      !canInlineFilterColumn(factTable, column)
    ) {
      return;
    }

    const datasource = await getDataSourceById(context, factTable.datasource);
    if (!datasource) return;

    try {
      const topValues = await runColumnTopValuesQuery(
        context,
        datasource,
        factTable,
        column
      );

      await updateColumn(factTable, columnId, {
        topValues,
      });
    } catch (e) {
      logger.error(
        `Error refreshing top values for column ${columnId} in fact table ${factTableId}`,
        e
      );
    }
  }
);

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(JOB_NAME, refreshFactTableTopValues);
}

export async function queueFactTableTopValuesRefresh(
  factTable: FactTableInterface,
  column: string
) {
  const job = agenda.create(JOB_NAME, {
    organization: factTable.organization,
    factTableId: factTable.id,
    column,
  }) as RefreshFactTableTopValuesJob;
  job.unique({
    organization: factTable.organization,
    factTableId: factTable.id,
    column,
  });
  job.schedule(new Date());
  await job.save();
}
