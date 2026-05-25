import Agenda, { Job } from "agenda";
import {
  EVENT_FORWARDER_WAREHOUSE_POLL_INTERVAL_MS,
  EVENT_FORWARDER_WAREHOUSE_POLL_TIMEOUT_MS,
  EVENT_FORWARDER_WAREHOUSE_SYNC_NO_CHANGE_DELAY_MS,
  EventForwarderWarehouseSyncExpectation,
} from "shared/util";
import { checkEventForwarderWarehouseReady } from "back-end/src/services/eventForwarderWarehouseReadiness";
import { runEventForwarderWarehouseRefreshes } from "back-end/src/services/eventForwarderWarehouseSync";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

const POLL_JOB_NAME = "pollEventForwarderWarehouseSync";
const REFRESH_JOB_NAME = "runEventForwarderWarehouseRefreshes";

type PollEventForwarderWarehouseSyncJob = Job<{
  organization: string;
  datasourceId: string;
  expectation: EventForwarderWarehouseSyncExpectation;
  startedAt: number;
}>;

type RunEventForwarderWarehouseRefreshesJob = Job<{
  organization: string;
  datasourceId: string;
}>;

export type QueueEventForwarderWarehouseSyncParams = {
  pingKind: "initial" | "manual";
  schemaChanged: boolean;
  newColumnNames?: string[];
};

export function buildEventForwarderWarehouseSyncExpectation(
  params: QueueEventForwarderWarehouseSyncParams,
): EventForwarderWarehouseSyncExpectation | null {
  if (params.pingKind === "initial") {
    return { kind: "initial" };
  }

  if (params.schemaChanged) {
    return {
      kind: "columnsAdded",
      columnNames: params.newColumnNames ?? [],
    };
  }

  return null;
}

const pollEventForwarderWarehouseSync = async (
  job: PollEventForwarderWarehouseSyncJob,
) => {
  const { organization, datasourceId, expectation, startedAt } = job.attrs.data;

  if (!organization || !datasourceId || !expectation) {
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organization);
  const { ready, reasons } = await checkEventForwarderWarehouseReady(
    context,
    datasourceId,
    expectation,
  );

  if (ready) {
    await runEventForwarderWarehouseRefreshes(context, datasourceId);
    return;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed >= EVENT_FORWARDER_WAREHOUSE_POLL_TIMEOUT_MS) {
    logger.warn(
      {
        organization,
        datasourceId,
        elapsed,
        reasons,
      },
      "Event forwarder warehouse sync poll timed out; running best-effort refreshes",
    );
    await runEventForwarderWarehouseRefreshes(context, datasourceId);
    return;
  }

  job.schedule(
    new Date(Date.now() + EVENT_FORWARDER_WAREHOUSE_POLL_INTERVAL_MS),
  );
  await job.save();
};

const runEventForwarderWarehouseRefreshesJob = async (
  job: RunEventForwarderWarehouseRefreshesJob,
) => {
  const { organization, datasourceId } = job.attrs.data;

  if (!organization || !datasourceId) {
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organization);
  await runEventForwarderWarehouseRefreshes(context, datasourceId);
};

let agenda: Agenda;

export default function addPollEventForwarderWarehouseSyncJob(ag: Agenda) {
  agenda = ag;

  agenda.define(POLL_JOB_NAME, pollEventForwarderWarehouseSync);
  agenda.define(REFRESH_JOB_NAME, runEventForwarderWarehouseRefreshesJob);
}

export async function queuePollEventForwarderWarehouseSync(
  context: ReqContext,
  datasourceId: string,
  expectation: EventForwarderWarehouseSyncExpectation,
): Promise<void> {
  const job = agenda.create(POLL_JOB_NAME, {
    organization: context.org.id,
    datasourceId,
    expectation,
    startedAt: Date.now(),
  }) as PollEventForwarderWarehouseSyncJob;
  job.unique({
    organization: context.org.id,
    datasourceId,
  });
  job.schedule(new Date());
  await job.save();
}

export async function queueDelayedEventForwarderWarehouseRefreshes(
  context: ReqContext,
  datasourceId: string,
  delayMs = EVENT_FORWARDER_WAREHOUSE_SYNC_NO_CHANGE_DELAY_MS,
): Promise<void> {
  const job = agenda.create(REFRESH_JOB_NAME, {
    organization: context.org.id,
    datasourceId,
  }) as RunEventForwarderWarehouseRefreshesJob;
  job.unique({
    organization: context.org.id,
    datasourceId,
  });
  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}

export async function queueEventForwarderWarehouseSync(
  context: ReqContext,
  datasourceId: string,
  params: QueueEventForwarderWarehouseSyncParams,
): Promise<void> {
  const expectation = buildEventForwarderWarehouseSyncExpectation(params);

  if (expectation) {
    await queuePollEventForwarderWarehouseSync(
      context,
      datasourceId,
      expectation,
    );
    return;
  }

  await queueDelayedEventForwarderWarehouseRefreshes(context, datasourceId);
}
