import Agenda, { Job } from "agenda";
import {
  getAllFactTablesWithAggregatedTablesEnabled,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { runAggregatedFactTableUpdate } from "back-end/src/services/aggregatedFactTables";
import { logger } from "back-end/src/util/logger";
import { getMostRecentUpdateOccurrence } from "back-end/src/util/factTable";

const QUEUE_AGGREGATED_FACT_TABLE_UPDATES = "queueAggregatedFactTableUpdates";
const UPDATE_SINGLE_AGGREGATED_FACT_TABLE = "updateSingleAggregatedFactTable";

type UpdateSingleAggregatedFactTableJob = Job<{
  organization: string;
  factTableId: string;
  idType: string;
  forceRestate?: boolean;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, pollAggregatedFactTables);

  agenda.define(
    UPDATE_SINGLE_AGGREGATED_FACT_TABLE,
    updateSingleAggregatedFactTable,
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateJob = agenda.create(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, {});
    updateJob.unique({});
    // Frequent poller: each table fires once per day at its own updateTime. The
    // claimScheduledSlot gate keeps the short interval from re-enqueueing a slot.
    updateJob.repeatEvery("1 minutes");
    await updateJob.save();
  }
}

type AgendaJobContext = Awaited<
  ReturnType<typeof getContextForAgendaJobByOrgId>
>;

async function pollAggregatedFactTables() {
  const factTables = await getAllFactTablesWithAggregatedTablesEnabled();
  const now = new Date();
  const contextCache = new Map<string, AgendaJobContext | null>();

  const getContext = async (
    organization: string,
  ): Promise<AgendaJobContext | null> => {
    if (contextCache.has(organization)) {
      return contextCache.get(organization) ?? null;
    }
    let context: AgendaJobContext | null = null;
    try {
      context = await getContextForAgendaJobByOrgId(organization);
      if (!context.hasPremiumFeature("pipeline-mode")) {
        context = null;
      }
    } catch (e) {
      logger.error(
        e,
        `Failed to load context for org ${organization} in aggregated fact table poller`,
      );
      context = null;
    }
    contextCache.set(organization, context);
    return context;
  };

  for (const factTable of factTables) {
    const settings = factTable.aggregatedFactTableSettings;
    if (!settings?.idTypes?.length) continue;

    let fireTime: Date;
    try {
      fireTime = getMostRecentUpdateOccurrence(settings.updateTime, now);
    } catch (e) {
      logger.error(
        e,
        `Invalid aggregatedFactTableSettings.updateTime for fact table ${factTable.id}`,
      );
      continue;
    }

    const context = await getContext(factTable.organization);
    if (!context) continue;

    for (const idType of settings.idTypes) {
      const key = {
        datasourceId: factTable.datasource,
        factTableId: factTable.id,
        idType,
      };
      let claimed = false;
      try {
        claimed = await context.models.aggregatedFactTables.claimScheduledSlot(
          key,
          fireTime,
        );
      } catch (e) {
        logger.error(
          e,
          `Failed to claim aggregated fact table slot for ${factTable.id}/${idType}`,
        );
        continue;
      }
      if (!claimed) continue;

      await queueAggregatedFactTableUpdate({
        organization: factTable.organization,
        factTableId: factTable.id,
        idType,
      });
    }
  }
}

export async function queueAggregatedFactTableUpdate({
  organization,
  factTableId,
  idType,
  forceRestate,
}: {
  organization: string;
  factTableId: string;
  idType: string;
  forceRestate?: boolean;
}) {
  const agenda = getAgendaInstance();
  const job = agenda.create(UPDATE_SINGLE_AGGREGATED_FACT_TABLE, {
    organization,
    factTableId,
    idType,
    forceRestate: forceRestate ?? false,
  });
  job.unique({
    organization,
    factTableId,
    idType,
  });
  job.schedule(new Date());
  await job.save();
}

const updateSingleAggregatedFactTable = async (
  job: UpdateSingleAggregatedFactTableJob,
) => {
  const { organization, factTableId, idType, forceRestate } =
    job.attrs.data ?? {};

  if (!organization || !factTableId || !idType) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  if (!context.hasPremiumFeature("pipeline-mode")) {
    return;
  }

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  if (!factTable.aggregatedFactTableSettings?.idTypes?.includes(idType)) {
    return;
  }

  await runAggregatedFactTableUpdate(context, factTable, idType, {
    forceRestate: !!forceRestate,
  });
};
