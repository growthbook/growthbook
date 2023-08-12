import { FaExternalLinkAlt } from "react-icons/fa";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Link from "next/link";
import { IdeaInterface } from "back-end/types/idea";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import VariationsTable from "../VariationsTable";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
  idea?: IdeaInterface;
  editVariations?: (() => void) | null;
}

export default function SetupTabOverview({
  experiment,
  mutate,
  safeToEdit,
  editVariations,
  idea,
}: Props) {
  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  return (
    <div>
      <div className="pl-1 mb-3">
        <h2>What&apos;s being tested?</h2>
      </div>

      <div className="appbox bg-white mb-4 p-3">
        <div>
          <MarkdownInlineEdit
            value={experiment.description ?? ""}
            save={async (description) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ description }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            className="mb-3"
            label="description"
            header="Description"
            headerClassName="h4"
          />

          <MarkdownInlineEdit
            value={experiment.hypothesis ?? ""}
            save={async (hypothesis) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ hypothesis }),
              });
              mutate();
            }}
            canCreate={canEditExperiment}
            canEdit={canEditExperiment}
            label="hypothesis"
            header={<>Hypothesis</>}
            headerClassName="h4"
            className="mb-3"
            containerClassName="mb-1"
          />

          {idea && (
            <div className="mb-3">
              <div className="d-flex align-items-center">
                <div className="mr-1">Idea:</div>
                <div>
                  {idea.impactScore > 0 && (
                    <div
                      className="badge badge-primary mr-1"
                      title="Impact Score"
                    >
                      {idea.impactScore}
                      <small>/100</small>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <Link href={`/idea/${idea.id}`}>
                  <a
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "inline-block",
                      whiteSpace: "nowrap",
                      verticalAlign: "middle",
                    }}
                    title={idea.text}
                  >
                    <FaExternalLinkAlt /> {idea.text}
                  </a>
                </Link>
              </div>
            </div>
          )}

          <HeaderWithEdit
            edit={editVariations && safeToEdit ? editVariations : undefined}
            containerClassName="mb-2"
            className="h4"
            disabledMessage={
              !safeToEdit &&
              "Cannot edit variations while the experiment is running."
            }
          >
            Variations
          </HeaderWithEdit>
          <div>
            <VariationsTable
              experiment={experiment}
              canEditExperiment={canEditExperiment}
              mutate={mutate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
