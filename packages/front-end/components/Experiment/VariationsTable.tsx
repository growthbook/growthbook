import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { FC } from "react";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  canEditExperiment: boolean;
  canEditVisualChangesets: boolean;
  className?: string;
  setVisualEditorModal: (v: boolean) => void;
  newUi?: boolean;
}

const ScreenshotCarousel: FC<{
  index: number;
  variation: Variation;
  canEditExperiment: boolean;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  maxChildHeight?: number;
  newUi?: boolean;
}> = ({
  canEditExperiment,
  experiment,
  index,
  variation,
  mutate,
  maxChildHeight,
  newUi,
}) => {
  const { apiCall } = useAuth();

  return (
    <Carousel
      deleteImage={
        !canEditExperiment
          ? undefined
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
      maxChildHeight={maxChildHeight}
      newUi={newUi}
    >
      {variation.screenshots.map((s) => (
        <img
          className={newUi ? "experiment-image-clean" : "experiment-image"}
          key={s.path}
          src={s.path}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      ))}
    </Carousel>
  );
};

const VariationsTable: FC<Props> = ({
  experiment,
  canEditExperiment,
  canEditVisualChangesets,
  mutate,
  visualChangesets: _visualChangesets,
  setVisualEditorModal,
  newUi,
}) => {
  const { variations } = experiment;
  // const { phase: phaseIndex } = useSnapshot();
  // const weights = experiment?.phases?.[phaseIndex]?.variationWeights ?? null;
  // const percentages =
  //   (weights?.length || 0) > 0 ? trafficSplitPercentages(weights) : null;

  const visualChangesets = _visualChangesets || [];

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");

  return (
    <div className="mx-1">
      <div
        className="mb-2 fade-mask-1rem"
        style={{
          overflowX: "auto",
        }}
      >
        <table
          className={clsx("table table-bordered mx-3", {
            "bg-light mw100-1rem": newUi,
            "w100-1rem": !newUi,
          })}
          style={newUi ? { width: "auto" } : {}}
        >
          <thead>
            <tr>
              {variations.map((v, i) => (
                <th
                  key={i}
                  className={`variation with-variation-label variation${i} ${
                    !(hasDescriptions || hasUniqueIDs)
                      ? "with-variation-border-bottom"
                      : "pb-2"
                  }`}
                  style={{
                    borderBottom:
                      hasDescriptions || hasUniqueIDs ? 0 : undefined,
                  }}
                >
                  <span className="label">{i}</span>
                  <span className="name">{v.name}</span>
                </th>
              ))}
            </tr>
            {hasDescriptions || hasUniqueIDs ? (
              <tr>
                {variations.map((v, i) => (
                  <td
                    className={`variation with-variation-border-bottom variation${i} pt-0 pb-1 align-bottom`}
                    style={{ borderTop: 0 }}
                    key={i}
                    scope="col"
                  >
                    {hasDescriptions ? <div>{v.description}</div> : null}
                    {hasUniqueIDs ? (
                      <code className="small">ID: {v.key}</code>
                    ) : null}
                  </td>
                ))}
              </tr>
            ) : null}
          </thead>

          <tbody>
            <tr>
              {variations.map((v, i) => (
                <td
                  key={i}
                  className={`align-${newUi ? "middle" : "top"} ${
                    canEditExperiment ? "pb-1" : ""
                  }`}
                  style={{
                    minWidth: "17.5rem",
                    maxWidth: "27rem",
                    width: `${80 / Math.min(variations.length || 1, 4)}rem`,
                    height: "inherit",
                    borderBottom: canEditExperiment ? 0 : undefined,
                  }}
                >
                  <div className="d-flex flex-column h-100">
                    {v.screenshots.length > 0 ? (
                      <ScreenshotCarousel
                        key={i}
                        index={i}
                        variation={v}
                        canEditExperiment={canEditExperiment}
                        experiment={experiment}
                        mutate={mutate}
                        maxChildHeight={newUi ? 200 : undefined}
                        newUi={newUi}
                      />
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
            {canEditExperiment && (
              <tr>
                {variations.map((v, i) => (
                  <td
                    key={`b${i}`}
                    className={`pt-0 ${newUi ? "pb-0" : "pb-1"}`}
                    style={{ borderTop: 0 }}
                  >
                    <div>
                      <ScreenshotUpload
                        variation={i}
                        experiment={experiment.id}
                        onSuccess={() => mutate()}
                        newUi={newUi}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!newUi && (
        <VisualChangesetTable
          experiment={experiment}
          visualChangesets={visualChangesets}
          mutate={mutate}
          canEditVisualChangesets={canEditVisualChangesets}
          setVisualEditorModal={setVisualEditorModal}
          newUi={newUi}
        />
      )}
    </div>
  );
};

export default VariationsTable;
