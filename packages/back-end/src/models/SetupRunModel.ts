import { z } from "zod";
import {
  setupRunValidator,
  apiUpdateSetupRunBody,
  SetupRunArtifact,
  ApiSetupRun,
} from "shared/validators";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  setupRunApiSpec,
  appendSetupRunArtifactEndpoint,
} from "back-end/src/api/specs/setup-run.spec";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: setupRunValidator,
  collectionName: "setupruns",
  idPrefix: "setr_",
  auditLog: {
    entity: "setupRun",
    createEvent: "setupRun.create",
    updateEvent: "setupRun.update",
    deleteEvent: "setupRun.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    source: "cli-wizard",
    wizardVersion: null,
    agent: null,
    createdBy: null,
    language: null,
    packageManager: null,
    appName: null,
    environment: null,
    intent: null,
    artifacts: [],
    checks: [],
    outcome: null,
    failureReason: null,
    dateCompleted: null,
  },
  apiConfig: {
    modelKey: "setupRuns",
    openApiSpec: setupRunApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...appendSetupRunArtifactEndpoint,
        reqHandler: async (req): Promise<ApiSetupRun> =>
          req.context.models.setupRuns.appendArtifactsApi(req.params.id, [
            req.body,
          ]),
      }),
    ],
  },
});

type SetupRunDoc = z.infer<typeof setupRunValidator>;

export class SetupRunModel extends BaseClass {
  // A record of the team's own onboarding activity, like an audit entry: readable
  // by any member, creatable by anyone who could have run the wizard.
  protected canRead(): boolean {
    return true;
  }

  protected canCreate(): boolean {
    return true;
  }

  protected canUpdate(): boolean {
    return true;
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }

  // Stamped from the session, never accepted from the caller, so "my last run" is
  // trustworthy and a client cannot attribute a run to someone else.
  protected async processApiCreateBody(rawBody: unknown) {
    return {
      ...(rawBody as object),
      createdBy: this.context.userId || null,
    } as never;
  }

  // A run stops being in-progress the moment an outcome is recorded.
  protected async processApiUpdateBody(rawBody: unknown) {
    const body = rawBody as z.infer<typeof apiUpdateSetupRunBody>;
    return {
      ...body,
      ...(body.outcome ? { dateCompleted: new Date() } : {}),
    } as never;
  }

  protected toApiInterface(doc: SetupRunDoc): ApiSetupRun {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      source: doc.source,
      wizardVersion: doc.wizardVersion,
      agent: doc.agent,
      createdBy: doc.createdBy,
      language: doc.language,
      packageManager: doc.packageManager,
      appName: doc.appName,
      environment: doc.environment,
      intent: doc.intent,
      artifacts: doc.artifacts.map((a) => ({
        ...a,
        dateCreated: a.dateCreated.toISOString(),
      })),
      checks: doc.checks,
      outcome: doc.outcome,
      failureReason: doc.failureReason,
      dateCompleted: doc.dateCompleted ? doc.dateCompleted.toISOString() : null,
      // Deliberately not under /setup: _app.tsx derives <main class="main setup">
      // from the first path segment, and main.setup zeroes the padding that clears
      // the sidebar — correct for the full-screen setup wizard, wrong here.
      url: `${APP_ORIGIN}/setup-runs/${doc.id}`,
    };
  }

  // toApiInterface is protected; the internal router needs a public way in.
  public toApi(doc: SetupRunDoc): ApiSetupRun {
    return this.toApiInterface(doc);
  }

  public async appendArtifactsApi(
    id: string,
    incoming: Omit<SetupRunArtifact, "dateCreated">[],
  ): Promise<ApiSetupRun> {
    return this.toApiInterface(await this.appendArtifacts(id, incoming));
  }

  // Idempotent on (kind, id) so a retried append, or the reconcile at the end of a
  // run resending one that already landed, does not produce a duplicate row.
  public async appendArtifacts(
    id: string,
    incoming: Omit<SetupRunArtifact, "dateCreated">[],
  ) {
    const run = await this.getById(id);
    if (!run) throw new Error(`Setup Run ${id} not found`);

    const artifacts = [...run.artifacts];
    for (const a of incoming) {
      const existing = artifacts.findIndex(
        (x) => x.kind === a.kind && x.id === a.id,
      );
      if (existing >= 0) {
        artifacts[existing] = { ...artifacts[existing], ...a };
      } else {
        artifacts.push({ ...a, dateCreated: new Date() });
      }
    }

    return this.updateById(id, { artifacts });
  }
}
