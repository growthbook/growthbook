import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FC, useState } from "react";
import { useAuth } from "@/services/auth";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import { GBAddCircle } from "../Icons";
import VisualChanges from "./VisualChanges";
import VisualChangesetModal from "./VisualChangesetModal";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  canEdit: boolean;
  className?: string;
}

const ScreenshotCarousel: FC<{
  index: number;
  variation: Variation;
  canEdit: boolean;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}> = ({ canEdit, experiment, index, variation, mutate }) => {
  const { apiCall } = useAuth();
  return (
    <Carousel
      deleteImage={
        !canEdit
          ? null
          : async (j) => {
              const { status, message } = await apiCall<{
                status: number;
                message?: string;
              }>(`/experiment/${experiment.id}/variation/${index}/screenshot`, {
                method: "DELETE",
                body: JSON.stringify({
                  url: variation.screenshots[j].path,
                }),
              });

              if (status >= 400) {
                throw new Error(
                  message || "There was an error deleting the image"
                );
              }

              mutate();
            }
      }
    >
      {variation.screenshots.map((s) => (
        <img className="experiment-image" key={s.path} src={s.path} />
      ))}
    </Carousel>
  );
};

const VariationsTable: FC<Props> = ({
  experiment,
  canEdit,
  mutate,
  visualChangesets: _visualChangesets,
}) => {
  const { variations } = experiment;
  const { apiCall } = useAuth();
  const [visualChangesets, setVisualChangesets] = useState<
    VisualChangesetInterface[]
  >(_visualChangesets ?? []);
  const [showVisualChangesetForm, setShowVisualChangesetForm] = useState(false);
  const [isEditingVisualChangeset, setIsEditingVisualChangeset] = useState(
    false
  );

  const createVisualChangeset = async ({
    editorUrl,
    urlPatterns,
  }: {
    editorUrl: string;
    urlPatterns: string[];
  }) => {
    const res = await apiCall<{ visualChangeset: VisualChangesetInterface }>(
      `/experiments/${experiment.id}/visual-changeset`,
      {
        method: "POST",
        body: JSON.stringify({ editorUrl, urlPatterns }),
      }
    );

    const { visualChangeset } = res;

    setVisualChangesets([...visualChangesets, visualChangeset]);
  };

  const updateVisualChangeset = async ({
    editorUrl,
    urlPatterns,
  }: Partial<VisualChangesetInterface>) => {
    // This will change when we suport multiple changesets
    const changesetId = visualChangesets[0].id;

    const res = await apiCall<{
      nModified: number;
      changesetId?: string;
      updates?: Partial<VisualChangesetInterface>;
    }>(`/visual-changesets/${changesetId}`, {
      method: "PUT",
      body: JSON.stringify({ editorUrl, urlPatterns }),
    });

    if (res.nModified > 0) {
      setVisualChangesets([
        ...visualChangesets.map((vc) => {
          if (vc.id === changesetId) {
            return {
              ...vc,
              ...res.updates,
            };
          }

          return vc;
        }),
      ]);
    }
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Name</th>

          {variations.map((v, i) => (
            <th key={i} scope="col">
              {v.name}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        <tr>
          <td scope="row">
            <strong>Description</strong>
          </td>
          {variations.map((v, i) => (
            <td key={i} scope="col">
              {v.description}
            </td>
          ))}
        </tr>

        <tr>
          <td scope="row">
            <strong>Screenshots</strong>
          </td>
          {variations.map((v, i) => (
            <td key={i} scope="col" style={{ minWidth: "18rem" }}>
              {v.screenshots.length > 0 ? (
                <ScreenshotCarousel
                  key={i}
                  index={i}
                  variation={v}
                  canEdit={canEdit}
                  experiment={experiment}
                  mutate={mutate}
                />
              ) : null}
              {canEdit && (
                <ScreenshotUpload
                  variation={i}
                  experiment={experiment.id}
                  onSuccess={() => mutate()}
                />
              )}
            </td>
          ))}
        </tr>

        {!visualChangesets.length ? (
          <tr>
            <td colSpan={variations.length + 1}>
              {showVisualChangesetForm ? (
                <VisualChangesetModal
                  onClose={() => setShowVisualChangesetForm(false)}
                  onSubmit={createVisualChangeset}
                />
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => setShowVisualChangesetForm(true)}
                >
                  <GBAddCircle /> Add Visual Changes
                </button>
              )}
            </td>
          </tr>
        ) : null}

        {isEditingVisualChangeset ? (
          <VisualChangesetModal
            editorUrl={visualChangesets[0].editorUrl}
            urlPatterns={visualChangesets[0].urlPatterns}
            onSubmit={updateVisualChangeset}
            onClose={() => setIsEditingVisualChangeset(false)}
          />
        ) : null}

        {visualChangesets.map((vc, i) => (
          <tr key={i}>
            <td>
              <strong>Visual Changes</strong>
              <div>
                <a
                  className="cursor-pointer"
                  onClick={() => setIsEditingVisualChangeset(true)}
                >
                  Edit URLs
                </a>
              </div>
            </td>

            {vc.visualChanges.map((_v, j) => (
              <td key={j}>
                <VisualChanges changeIndex={j} visualChangeset={vc} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default VariationsTable;
