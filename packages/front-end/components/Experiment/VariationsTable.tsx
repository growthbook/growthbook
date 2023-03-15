import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FC, useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import Field from "../Forms/Field";
import { GBAddCircle } from "../Icons";
import VisualChanges from "./VisualChanges";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  canEdit: boolean;
  className?: string;
}

const NewVisualChangesetModal: FC<{
  onClose: () => void;
  onSubmit: (args: { editorUrl: string; urlPatterns: string[] }) => void;
}> = ({ onClose, onSubmit }) => {
  const [editorUrl, setEditorUrl] = useState<string>("");
  const [urlPatterns, setUrlPatterns] = useState<string[]>([""]);
  const setUrlPattern = (p: string, i: number) => {
    const newUrlPatterns = [...urlPatterns];
    newUrlPatterns[i] = p;
    setUrlPatterns(newUrlPatterns);
  };
  const removeUrlPattern = (i: number) => {
    const newUrlPatterns = [...urlPatterns];
    newUrlPatterns.splice(i, 1);
    setUrlPatterns(newUrlPatterns);
  };

  return (
    <Modal
      open
      close={() => onClose()}
      size="lg"
      header="Add Visual Changes"
      submit={() => onSubmit({ editorUrl, urlPatterns })}
    >
      <Field
        required
        label="Visual Editor Target URL"
        helpText={
          "The web page the Visual Editor will make changes to. These changes can be applied to any site that matches your URL targeting rule."
        }
        value={editorUrl}
        onChange={(e) => setEditorUrl(e.currentTarget.value)}
      />
      {urlPatterns.map((p, i) => (
        <div key={i} className="d-flex align-items-center">
          <div className="flex-1">
            <Field
              required
              label="URL Targeting"
              helpText={
                <>
                  Target multiple URLs using regular expression. e.g.{" "}
                  <code>https://example.com/pricing</code> or{" "}
                  <code>^/post/[0-9]+</code>
                </>
              }
              value={urlPatterns[i]}
              onChange={(e) => setUrlPattern(e.currentTarget.value, i)}
            />
          </div>
          {urlPatterns.length > 1 && (
            <div className="flex-shrink-1 pl-2">
              <button
                type="button"
                className="close inline"
                onClick={() => removeUrlPattern(i)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        className="btn btn-primary"
        onClick={() => setUrlPatterns([...urlPatterns, ""])}
      >
        <GBAddCircle /> Add URL pattern
      </button>
    </Modal>
  );
};

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
                <NewVisualChangesetModal
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

        {visualChangesets.map((vc, i) => (
          <tr key={i}>
            <td>
              <strong>Visual Changes</strong>
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
