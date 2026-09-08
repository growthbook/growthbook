import { z } from "zod";
import {
  autoRunValidator,
  apiUpdateAutoRunBody,
  AutoRunArtifact,
  ApiAutoRun,
} from "shared/validators";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  autoRunApiSpec,
  appendAutoRunArtifactEndpoint,
} from "back-end/src/api/specs/auto-run.spec";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: autoRunValidator,
  collectionName: "autoruns",
  idPrefix: "arun_",
  auditLog: {
    entity: "autoRun",
    createEvent: "autoRun.create",
    updateEvent: "autoRun.update",
    deleteEvent: "autoRun.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    source: "cli-wizard",
    agent: null,
    createdBy: null,
    metadata: {},
    artifacts: [],
    checks: [],
    outcome: null,
    failureReason: null,
    dateCompleted: null,
  },
  apiConfig: {
    modelKey: "autoRuns",
    openApiSpec: autoRunApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...appendAutoRunArtifactEndpoint,
        reqHandler: async (req): Promise<ApiAutoRun> =>
          req.context.models.autoRuns.appendArtifactsApi(req.params.id, [
            req.body,
          ]),
      }),
    ],
  },
});

type AutoRunDoc = z.infer<typeof autoRunValidator>;

export class AutoRunModel extends BaseClass {
  // A record of the team's own onboarding activity, like an audit entry: readable
  // by any member, creatable by anyone who could have run the wizard.
  protected canRead(): boolean {
    return true;
  }

  protected canCreate(): boolean {
    return true;
  }

  // Only the developer who ran the wizard, or an org admin, may rewrite a run's
  // checks and outcome. Runs created with an org-level key carry no owner and
  // stay open to any member, as before.
  protected canUpdate(existing: AutoRunDoc): boolean {
    if (this.context.permissions.canManageOrgSettings()) return true;
    const owner = existing.createdBy ?? null;
    return owner === null || owner === this.context.userId;
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
    const body = rawBody as z.infer<typeof apiUpdateAutoRunBody>;
    return {
      ...body,
      ...(body.outcome ? { dateCompleted: new Date() } : {}),
    } as never;
  }

  protected toApiInterface(doc: AutoRunDoc): ApiAutoRun {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      source: doc.source,
      agent: doc.agent,
      createdBy: doc.createdBy,
      // Documents written before metadata existed have no such field, and the API
      // declares it required — returning undefined would break every reader that
      // trusts the type rather than re-checking it.
      metadata: doc.metadata ?? {},
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
      // The page looks the run up in the browser's current organization, which need not be
      // the one the run was created in when a user belongs to several. Name it in the URL.
      url: `${APP_ORIGIN}/auto-runs/${doc.id}?org=${encodeURIComponent(doc.organization)}`,
    };
  }

  // toApiInterface is protected; the internal router needs a public way in.
  public toApi(doc: AutoRunDoc): ApiAutoRun {
    return this.toApiInterface(doc);
  }

  public async appendArtifactsApi(
    id: string,
    incoming: Omit<AutoRunArtifact, "dateCreated">[],
  ): Promise<ApiAutoRun> {
    return this.toApiInterface(await this.appendArtifacts(id, incoming));
  }

  // Idempotent on (kind, id) so a retried append, or the reconcile at the end of a
  // run resending one that already landed, does not produce a duplicate row. The
  // compare-and-swap on the array keeps two overlapping appends (an agent running
  // its tool calls in parallel) from each storing a copy that lacks the other's.
  public async appendArtifacts(
    id: string,
    incoming: Omit<AutoRunArtifact, "dateCreated">[],
  ) {
    const run = await this.updateWithCas(id, ["artifacts"], (existing) => {
      const artifacts = [...existing.artifacts];
      for (const a of incoming) {
        const index = artifacts.findIndex(
          (x) => x.kind === a.kind && x.id === a.id,
        );
        if (index >= 0) {
          artifacts[index] = { ...artifacts[index], ...a };
        } else {
          artifacts.push({ ...a, dateCreated: new Date() });
        }
      }
      return { artifacts };
    });
    if (!run) throw new Error(`Auto Run ${id} not found`);
    return run;
  }
}
