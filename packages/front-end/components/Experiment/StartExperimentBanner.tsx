import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import Link from "next/link";
import { MatchingRule } from "shared/util";
import { MdRocketLaunch } from "react-icons/md";
import { ReactElement } from "react";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import Button from "../Button";

export function StartExperimentBanner({
  experiment,
  linkedFeatures,
  visualChangesets,
  connections,
  mutateExperiment,
  editPhase,
  newPhase,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: {
    feature: FeatureInterface;
    rules: MatchingRule[];
  }[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  mutateExperiment: () => unknown | Promise<unknown>;
  newPhase?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
}) {
  const { apiCall } = useAuth();

  if (experiment.status !== "draft") return null;

  const hasSDKWithVisualExperimentsEnabled = connections.some(
    (connection) => connection.includeVisualExperiments
  );

  // See if at least one visual change has been made with the editor
  const hasSomeVisualChanges = visualChangesets?.some((vc) =>
    vc.visualChanges.some(
      (changes) => changes.css || changes.js || changes.domMutations?.length > 0
    )
  );

  const errors: (ReactElement | string)[] = [];

  if (
    linkedFeatures.some((f) =>
      f.rules.some(
        (r) => r.draft || !r.environmentEnabled || r.rule.enabled === false
      )
    )
  ) {
    errors.push(`Some of the linked Feature Flags are not live. Make sure the environments are enabled and your
      changes are published.`);
  }

  if (visualChangesets.length > 0 && !hasSomeVisualChanges) {
    errors.push(`None of the feature flags linked to this
            experiment are live. Make sure the environments are enabled and your
            changes are published.`);
  }

  if (visualChangesets.length > 0 && !hasSDKWithVisualExperimentsEnabled) {
    errors.push(
      <>
        Visual Editor experiments are not being sent to your SDKs. Before
        starting the experiment, you must edit your connection to include Visual
        Editor experiments. <Link href="/sdks">View SDK Connections</Link>
      </>
    );
  }

  if (!linkedFeatures.length && !visualChangesets.length) {
    errors.push(
      `You don't have any linked Feature Flag or Visual Editor changes. If you are implementing this test outside of GrowthBook, you can ignore this error.`
    );
  }

  async function startExperiment() {
    if (!experiment.phases?.length) {
      if (newPhase) {
        newPhase();
        return;
      } else {
        throw new Error("You do not have permission to start this experiment");
      }
    }

    await apiCall(`/experiment/${experiment.id}/status`, {
      method: "POST",
      body: JSON.stringify({
        status: "running",
      }),
    });
    await mutateExperiment();
    track("Start experiment", {
      source: "experiment-start-banner",
      action: "main CTA",
    });
  }

  if (errors.length > 0) {
    return (
      <>
        <div className="alert alert-danger mb-5">
          <h4>Please fix the below errors before starting your experiment</h4>
          <ul className="mb-0">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  // Prompt them to start with an option to edit the targeting first
  return (
    <div className="alert-cool-1 mb-5 text-center px-3 py-4">
      <p className="h4 mb-4">Done setting everything up?</p>
      <Button
        color="primary"
        className="btn-lg"
        onClick={async () => {
          await startExperiment();
        }}
      >
        Start Experiment <MdRocketLaunch />
      </Button>{" "}
      {(experiment.phases?.length || 0) > 0 && (
        <Button
          className="ml-2"
          color="link"
          onClick={async () => {
            if (editPhase) editPhase(experiment.phases.length - 1);
            track("Edit phase", { source: "experiment-start-banner" });
          }}
        >
          Edit Targeting
        </Button>
      )}
    </div>
  );
}
