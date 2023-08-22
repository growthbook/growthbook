import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { IdeaInterface } from "back-end/types/idea";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FeatureInterface } from "back-end/types/feature";
import {
  MatchingRule,
  getMatchingRules,
  includeExperimentInPayload,
} from "shared/util";
import { useMemo, useState } from "react";
import { FaChartBar } from "react-icons/fa";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useEnvironments, useFeaturesList } from "@/services/features";
import FeatureFromExperimentModal from "@/components/Features/FeatureModal/FeatureFromExperimentModal";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import { openVisualEditor } from "@/components/OpenVisualEditorLink";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import DiscussionThread from "@/components/DiscussionThread";
import EditStatusModal from "../EditStatusModal";
import VisualChangesetModal from "../VisualChangesetModal";
import EditExperimentNameForm from "../EditExperimentNameForm";
import { useSnapshot } from "../SnapshotProvider";
import ExperimentHeader from "./ExperimentHeader";
import ProjectTagBar from "./ProjectTagBar";
import SetupTabOverview from "./SetupTabOverview";
import Implementation from "./Implementation";
import ResultsTab from "./ResultsTab";
import StoppedExperimentBanner from "./StoppedExperimentBanner";

export type ExperimentTab = "setup" | "results";

export type LinkedFeature = {
  feature: FeatureInterface;
  rules: MatchingRule[];
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  duplicate?: (() => void) | null;
  editTags?: (() => void) | null;
  editProject?: (() => void) | null;
  idea?: IdeaInterface;
  editVariations?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
  editTargeting?: (() => void) | null;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
}

export default function TabbedPage({
  experiment,
  mutate,
  duplicate,
  editProject,
  editTags,
  idea,
  editVariations,
  visualChangesets,
  editPhases,
  editTargeting,
  newPhase,
  editMetrics,
  editResult,
}: Props) {
  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__${experiment.id}`,
    "setup"
  );

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);

  const { phase, setPhase } = useSnapshot();
  const viewingOldPhase =
    experiment.phases.length > 0 && phase < experiment.phases.length - 1;

  const setTabAndScroll = (tab: ExperimentTab) => {
    setTab(tab);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const { features, mutate: mutateFeatures } = useFeaturesList(false);
  const environments = useEnvironments();

  const { linkedFeatures, legacyFeatures } = useMemo(() => {
    const environmentIds = environments.map((e) => e.id);

    const linkedFeatures: LinkedFeature[] = [];
    const legacyFeatures: LinkedFeature[] = [];

    features.forEach((feature) => {
      const refRules = getMatchingRules(
        feature,
        (rule) =>
          rule.type === "experiment-ref" && rule.experimentId === experiment.id,
        environmentIds
      );
      if (refRules.length > 0) {
        linkedFeatures.push({ feature, rules: refRules });
        return;
      }

      const legacyRules = getMatchingRules(
        feature,
        (rule) =>
          rule.type === "experiment" &&
          (rule.trackingKey || feature.id) === experiment.trackingKey,
        environmentIds
      );
      if (legacyRules.length > 0) {
        legacyFeatures.push({ feature, rules: legacyRules });
      }
    });

    return { linkedFeatures, legacyFeatures };
  }, [features, environments, experiment.id, experiment.trackingKey]);

  const hasLiveLinkedChanges = includeExperimentInPayload(
    experiment,
    features.filter((f) => experiment.linkedFeatures?.includes(f.id))
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = sdkConnectionsData?.connections || [];

  const watcherIds = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const { users } = useUser();

  // Get name or email of all active users watching this experiment
  const usersWatching = (watcherIds?.data?.userIds || [])
    .map((id) => users.get(id))
    .filter(Boolean)
    .map((u) => u?.name || u?.email);

  const safeToEdit = experiment.status !== "running" || !hasLiveLinkedChanges;

  return (
    <div>
      {editNameOpen && (
        <EditExperimentNameForm
          experiment={experiment}
          mutate={mutate}
          cancel={() => setEditNameOpen(false)}
        />
      )}
      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="experiment" id={experiment.id} />
        </Modal>
      )}
      {watchersModal && (
        <Modal
          open={true}
          header="Experiment Watchers"
          close={() => setWatchersModal(false)}
          closeCta="Close"
        >
          <ul>
            {usersWatching.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </Modal>
      )}
      {visualEditorModal && (
        <VisualChangesetModal
          mode="add"
          experiment={experiment}
          mutate={mutate}
          close={() => setVisualEditorModal(false)}
          onCreate={async (vc) => {
            // Try to immediately open the visual editor
            await openVisualEditor(vc);
          }}
          cta="Open Visual Editor"
        />
      )}
      {statusModal && (
        <EditStatusModal
          experiment={experiment}
          close={() => setStatusModal(false)}
          mutate={mutate}
        />
      )}
      {featureModal && (
        <FeatureFromExperimentModal
          features={features}
          experiment={experiment}
          close={() => setFeatureModal(false)}
          onSuccess={async () => {
            await mutateFeatures();
          }}
        />
      )}
      <ExperimentHeader
        experiment={experiment}
        tab={tab}
        setTab={setTabAndScroll}
        mutate={mutate}
        safeToEdit={safeToEdit}
        setAuditModal={setAuditModal}
        setEditNameOpen={setEditNameOpen}
        setStatusModal={setStatusModal}
        setWatchersModal={setWatchersModal}
        duplicate={duplicate}
        usersWatching={usersWatching}
        editResult={editResult || undefined}
        connections={connections}
        linkedFeatures={linkedFeatures}
        visualChangesets={visualChangesets}
        editTargeting={editTargeting}
        newPhase={newPhase}
        editPhases={editPhases}
      />
      <div className="container pagecontents pb-4">
        {experiment.status === "stopped" && (
          <div className="pt-3">
            <StoppedExperimentBanner
              experiment={experiment}
              linkedFeatures={linkedFeatures}
              mutate={mutate}
              editResult={editResult || undefined}
            />
          </div>
        )}
        {viewingOldPhase && (
          <div className="alert alert-warning mt-3">
            You are viewing the {tab} of a previous experiment phase.{" "}
            {tab === "setup" ? "Editing has been disabled. " : ""}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setPhase(experiment.phases.length - 1);
              }}
            >
              Switch to the latest phase
            </a>
          </div>
        )}
        <div
          className="pt-3"
          style={{ display: tab === "setup" ? "block" : "none" }}
        >
          <ProjectTagBar
            experiment={experiment}
            editProject={!viewingOldPhase ? editProject : undefined}
            editTags={!viewingOldPhase ? editTags : undefined}
            idea={idea}
          />
          <SetupTabOverview
            experiment={experiment}
            mutate={mutate}
            safeToEdit={safeToEdit}
            editVariations={!viewingOldPhase ? editVariations : undefined}
            disableEditing={viewingOldPhase}
          />
          <Implementation
            experiment={experiment}
            mutate={mutate}
            setFeatureModal={setFeatureModal}
            setVisualEditorModal={setVisualEditorModal}
            visualChangesets={visualChangesets}
            editTargeting={!viewingOldPhase ? editTargeting : undefined}
            linkedFeatures={linkedFeatures}
            legacyFeatures={legacyFeatures}
            mutateFeatures={mutateFeatures}
            connections={connections}
            setTab={setTabAndScroll}
          />
          {experiment.status !== "draft" && (
            <div className="mt-3 mb-2 text-center">
              <button
                className="btn btn-lg btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  setTabAndScroll("results");
                }}
              >
                <FaChartBar /> View Results
              </button>
            </div>
          )}
        </div>
        <div style={{ display: tab === "results" ? "block" : "none" }}>
          <ResultsTab
            experiment={experiment}
            mutate={mutate}
            editMetrics={editMetrics}
            editPhases={editPhases}
            editResult={editResult}
            newPhase={newPhase}
            connections={connections}
            linkedFeatures={linkedFeatures}
            setTab={setTab}
            visualChangesets={visualChangesets}
            editTargeting={editTargeting}
            isTabActive={tab === "results"}
          />
        </div>
      </div>

      <div
        className="bg-white mt-4 px-4 border-top"
        style={{ marginLeft: -8, marginRight: -8 }}
      >
        <div className="pt-2 pt-4 pb-5 container pagecontents">
          <div className="h3 mb-4">Comments</div>
          <DiscussionThread
            type="experiment"
            id={experiment.id}
            allowNewComments={!experiment.archived}
            project={experiment.project}
          />
        </div>
      </div>
    </div>
  );
}
