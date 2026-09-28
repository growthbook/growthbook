import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import type { ApiReqContext } from "back-end/types/api";
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";

describe("requireVisualChangeWrite", () => {
  const onlyDrafts = expect.stringContaining("Only draft experiments");
  const everywhere = [["__ALL__"]];
  const audited = [{ visualChangesetId: "vcs_1", liveVisualChangeEdit: true }];

  it.each<{
    label: string;
    fields: Partial<ExperimentInterface>;
    allowRunning: boolean;
    canRun: boolean;
    expected: { result: unknown; checkedEnvs: string[][]; audited: unknown[] };
  }>([
    {
      label: "allows a draft with no further check",
      fields: { status: "draft" },
      allowRunning: false,
      canRun: true,
      expected: { result: "allowed", checkedEnvs: [], audited: [] },
    },
    {
      label:
        "allows a stopped experiment with no opt-in, checked everywhere and audited",
      fields: { status: "stopped" },
      allowRunning: false,
      canRun: true,
      expected: { result: "allowed", checkedEnvs: everywhere, audited },
    },
    {
      label:
        "allows a running experiment with the opt-in, checked everywhere and audited",
      fields: { status: "running" },
      allowRunning: true,
      canRun: true,
      expected: { result: "allowed", checkedEnvs: everywhere, audited },
    },
    {
      label: "refuses a running experiment without the opt-in",
      fields: { status: "running" },
      allowRunning: false,
      canRun: true,
      expected: { result: onlyDrafts, checkedEnvs: [], audited: [] },
    },
    {
      label:
        "refuses someone who can run the experiment in only some environments",
      fields: { status: "stopped" },
      allowRunning: false,
      canRun: false,
      expected: {
        result: "permission denied",
        checkedEnvs: everywhere,
        audited: [],
      },
    },
    {
      label: "refuses an archived experiment",
      fields: { status: "stopped", archived: true },
      allowRunning: true,
      canRun: true,
      expected: { result: onlyDrafts, checkedEnvs: [], audited: [] },
    },
  ])("$label", async ({ fields, allowRunning, canRun, expected }) => {
    const canRunExperiment = jest.fn<boolean, [unknown, string[]]>(
      () => canRun,
    );
    const audit = jest.fn<Promise<void>, [AuditInterfaceInput]>(
      async () => undefined,
    );
    const context = {
      throwBadRequestError: (message: string) => {
        throw new Error(message);
      },
      permissions: {
        canRunExperiment,
        throwPermissionError: () => {
          throw new Error("permission denied");
        },
      },
    } as unknown as ApiReqContext;
    const experiment = {
      id: "exp_1",
      project: "",
      archived: false,
      ...fields,
    } as ExperimentInterface;

    const result = await Promise.resolve()
      .then(() =>
        requireVisualChangeWrite({ context, audit }, experiment, {
          allowRunning,
          visualChangesetId: "vcs_1",
        }),
      )
      .then((auditEdit) => auditEdit())
      .then(
        () => "allowed",
        (e: Error) => e.message,
      );

    expect({
      result,
      checkedEnvs: canRunExperiment.mock.calls.map(([, envs]) => envs),
      audited: audit.mock.calls.map(
        ([data]) => JSON.parse(data.details ?? "null").context,
      ),
    }).toEqual(expected);
  });
});
