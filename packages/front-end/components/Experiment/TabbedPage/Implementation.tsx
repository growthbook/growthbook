import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FaPlusCircle } from "react-icons/fa";
import { MdInfoOutline } from "react-icons/md";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import usePermissions from "@/hooks/usePermissions";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import LinkedFeatureFlag from "@/components/Experiment/LinkedFeatureFlag";
import track from "@/services/track";
import { formatTrafficSplit } from "@/services/utils";
import HeaderWithEdit from "../../Layout/HeaderWithEdit";
import Tooltip from "../../Tooltip/Tooltip";
import { HashVersionTooltip } from "../HashVersionSelector";
import { StartExperimentBanner } from "../StartExperimentBanner";
import AddLinkedChangesBanner from "../AddLinkedChangesBanner";
import { ExperimentTab, LinkedFeature } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  editTargeting?: (() => void) | null;
  setFeatureModal: (open: boolean) => void;
  setVisualEditorModal: (open: boolean) => void;
  linkedFeatures: LinkedFeature[];
  legacyFeatures: LinkedFeature[];
  mutateFeatures: () => void;
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
}

export default function Implementation({
  experiment,
  visualChangesets,
  mutate,
  editTargeting,
  setFeatureModal,
  setVisualEditorModal,
  mutateFeatures,
  linkedFeatures,
  legacyFeatures,
  setTab,
  connections,
}: Props) {
  const phases = experiment.phases || [];
  const phase = phases[phases.length - 1] as
    | undefined
    | ExperimentPhaseStringDates;
  const hasNamespace = phase?.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const permissions = usePermissions();

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  const hasVisualEditorPermission =
    canEditExperiment &&
    permissions.check("runExperiments", experiment.project, []);

  const hasLinkedChanges =
    visualChangesets.length > 0 || linkedFeatures.length > 0;
  const hasAnyChanges = hasLinkedChanges || legacyFeatures.length > 0;

  if (!hasAnyChanges) {
    if (experiment.status === "draft") {
      return (
        <>
          <AddLinkedChangesBanner
            experiment={experiment}
            numLinkedChanges={0}
            setFeatureModal={setFeatureModal}
            setVisualEditorModal={setVisualEditorModal}
          />
          <div className="mt-1">
            <StartExperimentBanner
              experiment={experiment}
              mutateExperiment={mutate}
              linkedFeatures={linkedFeatures}
              visualChangesets={visualChangesets}
              onStart={() => setTab("results")}
              editTargeting={editTargeting}
              connections={connections}
              className="appbox p-4"
            />
          </div>
        </>
      );
    }
    return (
      <div className="alert alert-info mb-0">
        This experiment has no feature flag or visual editor changes which are
        managed within the GrowthBook app. Randomization and targeting is likely
        managed manually or by an external service.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="pl-1 mb-3">
        <h2>Implementation</h2>
      </div>
      <div className="row">
        <div className={hasLinkedChanges ? "col-md-8 col-12 mb-3" : "col"}>
          <div className="appbox p-3 h-100 mb-0">
            {(experiment.status === "draft" || linkedFeatures.length > 0) && (
              <div className="mb-4">
                <div className="h4 mb-2">
                  Linked Features{" "}
                  <small className="text-muted">
                    ({linkedFeatures.length})
                  </small>
                </div>
                {linkedFeatures.map(({ feature, rules }, i) => (
                  <LinkedFeatureFlag
                    feature={feature}
                    rules={rules}
                    experiment={experiment}
                    key={i}
                    mutateFeatures={mutateFeatures}
                  />
                ))}
                {experiment.status === "draft" && hasVisualEditorPermission && (
                  <button
                    className="btn btn-link"
                    type="button"
                    onClick={() => {
                      setFeatureModal(true);
                      track("Open linked feature modal", {
                        source: "linked-changes",
                        action: "add",
                      });
                    }}
                  >
                    <FaPlusCircle className="mr-1" />
                    Add Feature Flag
                  </button>
                )}
              </div>
            )}
            {(experiment.status === "draft" || visualChangesets.length > 0) && (
              <div>
                <div className="h4 mb-2">
                  Visual Editor Changes{" "}
                  <small className="text-muted">
                    ({visualChangesets.length})
                  </small>
                </div>
                <VisualChangesetTable
                  experiment={experiment}
                  visualChangesets={visualChangesets}
                  mutate={mutate}
                  canEditVisualChangesets={hasVisualEditorPermission}
                  setVisualEditorModal={setVisualEditorModal}
                />
              </div>
            )}
            {legacyFeatures.length > 0 && (
              <div className="mt-4">
                <div className="h4 mb-2">
                  Legacy Features{" "}
                  <small className="text-muted">
                    ({legacyFeatures.length})
                  </small>
                </div>
                <div className="alert alert-info">
                  These features have rules that reference this Experiment Key,
                  but contain their own targeting settings. Changes you make to
                  this experiment will have no effect on these features.
                </div>

                {legacyFeatures.map(({ feature, rules }, i) => (
                  <LinkedFeatureFlag
                    feature={feature}
                    rules={rules}
                    experiment={experiment}
                    key={i}
                    mutateFeatures={mutateFeatures}
                    open={false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {hasLinkedChanges && (
          <div className="col-md-4 col-lg-4 col-12 mb-3">
            <div className="appbox p-3 h-100 mb-0">
              <HeaderWithEdit
                edit={editTargeting || undefined}
                className="h3"
                containerClassName="mb-3"
              >
                Targeting
              </HeaderWithEdit>
              {phase ? (
                <div className="row">
                  <div className="col">
                    <div className="mb-3">
                      <div className="mb-1">
                        <strong>Experiment Key</strong>{" "}
                        <Tooltip body="This is hashed together with the assignment attribute (below) to deterministically assign users to a variation." />
                      </div>
                      <div>{experiment.trackingKey}</div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1">
                        <strong>Assignment Attribute</strong>{" "}
                        <Tooltip body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie.">
                          <MdInfoOutline className="text-info" />
                        </Tooltip>
                      </div>
                      <div>
                        {experiment.hashAttribute || "id"}{" "}
                        {
                          <HashVersionTooltip>
                            <small className="text-muted ml-1">
                              (V{experiment.hashVersion || 2} hashing)
                            </small>
                          </HashVersionTooltip>
                        }
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1">
                        <strong>Targeting Conditions</strong>
                      </div>
                      <div>
                        {phase.condition && phase.condition !== "{}" ? (
                          <ConditionDisplay condition={phase.condition} />
                        ) : (
                          <em>No conditions</em>
                        )}
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1">
                        <strong>Traffic</strong>
                      </div>
                      <div>
                        {Math.floor(phase.coverage * 100)}% included,{" "}
                        {formatTrafficSplit(phase.variationWeights)} split
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1">
                        <strong>Namespace</strong>{" "}
                        <Tooltip body="Use namespaces to run mutually exclusive experiments. Manage namespaces under SDK Configuration -> Namespaces">
                          <MdInfoOutline className="text-info" />
                        </Tooltip>
                      </div>
                      <div>
                        {hasNamespace ? (
                          <>
                            {phase.namespace.name}{" "}
                            <span className="text-muted">
                              ({percentFormatter.format(namespaceRange)})
                            </span>
                          </>
                        ) : (
                          <em>Global (all users)</em>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <em>No targeting configured yet</em>
              )}
            </div>
          </div>
        )}
      </div>

      {experiment.status === "draft" && (
        <div className="mt-1">
          <StartExperimentBanner
            experiment={experiment}
            mutateExperiment={mutate}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            onStart={() => setTab("results")}
            editTargeting={editTargeting}
            connections={connections}
            className="appbox p-4"
          />
        </div>
      )}
    </div>
  );
}
