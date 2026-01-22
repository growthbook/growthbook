import Agenda, { Job } from "agenda";
import chunk from "lodash/chunk";
import { canInlineFilterColumn } from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { ReqContext } from "back-end/types/request";
import {
  getAllFactTablesWithAutoSliceUpdatesEnabled,
  getFactTable,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { runColumnsTopValuesQuery } from "./refreshFactTableColumns";

const QUEUE_AUTO_SLICE_UPDATES = "queueAutoSliceUpdates";
const UPDATE_SINGLE_FACT_TABLE_AUTO_SLICES = "updateSingleFactTableAutoSlices";

type UpdateSingleFactTableAutoSlicesJob = Job<{
  organization: string;
  factTableId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_AUTO_SLICE_UPDATES, async () => {
    const factTables = await getAllFactTablesToUpdate();

    for (const factTable of factTables) {
      await queueAutoSliceUpdate(factTable);
    }
  });

  agenda.define(
    UPDATE_SINGLE_FACT_TABLE_AUTO_SLICES,
    updateSingleFactTableAutoSlices,
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateJob = agenda.create(QUEUE_AUTO_SLICE_UPDATES, {});
    updateJob.unique({});
    updateJob.repeatEvery(1 + " minutes");
    await updateJob.save();
  }

  async function queueAutoSliceUpdate(factTable: FactTableInterface) {
    const job = agenda.create(UPDATE_SINGLE_FACT_TABLE_AUTO_SLICES, {
      organization: factTable.organization,
      factTableId: factTable.id,
    });
    job.unique({
      organization: factTable.organization,
      factTableId: factTable.id,
    });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleFactTableAutoSlices = async (
  job: UpdateSingleFactTableAutoSlicesJob,
) => {
  const { organization, factTableId } = job.attrs.data;

  if (!factTableId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  // Only update if auto-slice updates are enabled
  if (!factTable.autoSliceUpdatesEnabled) return;

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) return;

  try {
    const updatedColumns = await updateAutoSlicesForColumns(
      context,
      datasource,
      factTable,
    );

    if (updatedColumns.length > 0) {
      await updateFactTableColumns(
        factTable,
        { columns: updatedColumns },
        context,
      );
      logger.info(
        `Updated auto-slices for fact table ${factTableId} in organization ${organization}`,
      );
    }
  } catch (e) {
    logger.error(e, "Failed to update auto-slices", {
      factTableId,
      organization,
    });
  }
};

async function updateAutoSlicesForColumns(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
): Promise<ColumnInterface[]> {
  const columns = [...factTable.columns];
  const maxSliceLevels =
    context.org.settings?.maxMetricSliceLevels ??
    DEFAULT_MAX_METRIC_SLICE_LEVELS;

  // Collect columns that need auto-slice updates
  const columnsNeedingUpdates: ColumnInterface[] = [];
  for (const col of columns) {
    // Skip boolean columns (they always use ["true", "false"])
    if (col.datatype === "boolean") continue;

    // Only update auto-slice columns that are string type
    if (
      col.isAutoSliceColumn &&
      col.datatype === "string" &&
      !col.deleted &&
      canInlineFilterColumn(factTable, col.column)
    ) {
      columnsNeedingUpdates.push(col);
    }
  }

  // Batch query for all columns that need updates, chunked into groups of 10
  // to prevent returning more than 1k rows per update (10 columns * 100 values = 1000 rows max per chunk)
  if (columnsNeedingUpdates.length > 0) {
    const columnChunks = chunk(columnsNeedingUpdates, 10);

    for (const columnChunk of columnChunks) {
      try {
        const topValuesByColumn = await runColumnsTopValuesQuery(
          context,
          datasource,
          factTable,
          columnChunk,
        );

        // Process results for each column
        for (const col of columnChunk) {
          const topValues = topValuesByColumn[col.column] || [];

          // Persist topValues and topValuesDate
          col.topValues = topValues;
          col.topValuesDate = new Date();

          // Update autoSlices with locked levels + new top values
          const lockedLevels = col.lockedAutoSlices || [];
          const autoSlices: string[] = [...lockedLevels];
          for (const value of topValues) {
            if (autoSlices.length >= maxSliceLevels) break;
            if (!autoSlices.includes(value)) {
              autoSlices.push(value);
            }
          }

          col.autoSlices = autoSlices;
          col.dateUpdated = new Date();
        }
      } catch (e) {
        logger.error(e, "Error updating auto-slices for columns", {
          factTableId: factTable.id,
          columns: columnChunk.map((c) => c.column),
        });
      }
    }
  }

  return columns;
}

async function getAllFactTablesToUpdate(): Promise<FactTableInterface[]> {
  return await getAllFactTablesWithAutoSliceUpdatesEnabled();
}
