import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { FC } from "react";
import { useAuth } from "@/services/auth";
import { trafficSplitPercentages } from "@/services/utils";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import AuthorizedImage from "../AuthorizedImage";

const imageCache = {};

const ScreenshotCarousel: FC<{
  index: number;
  variation: Variation;
  canEditExperiment: boolean;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  maxChildHeight?: number;
}> = ({
  canEditExperiment,
  experiment,
  index,
  variation,
  mutate,
  maxChildHeight,
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
    >
      {variation.screenshots.map((s) => (
        <AuthorizedImage
          imageCache={imageCache}
          className="experiment-image"
          src={s.path}
          key={s.path}
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

interface Props {
  experiment: ExperimentInterfaceStringDates;
  canEditExperiment: boolean;
  mutate: () => void;
}

const VariationsTable: FC<Props> = ({
  experiment,
  canEditExperiment,
  mutate,
}) => {
  const { variations } = experiment;
  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];
  const weights = lastPhase?.variationWeights ?? null;
  const percentages =
    (weights?.length || 0) > 0 ? trafficSplitPercentages(weights) : null;

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");

  return (
    <div>
      <div
        className="fade-mask-1rem"
        style={{
          overflowX: "auto",
        }}
      >
        <table
          className="table table-bordered mx-3 bg-light mw100-1rem"
          style={{ width: "auto" }}
        >
          <thead>
            <tr>
              {variations.map((v, i) => (
                <th
                  key={i}
                  className={`variation with-variation-label variation${i}`}
                  style={{ borderBottom: 0 }}
                >
                  <span className="label">{i}</span>
                  <span className="name">{v.name}</span>
                </th>
              ))}
            </tr>
            <tr>
              {variations.map((v, i) => (
                <th
                  className={`variation with-variation-border-bottom variation${i} pt-0 pb-1 align-bottom font-weight-normal`}
                  style={{ borderTop: 0 }}
                  key={i}
                  scope="col"
                >
                  {hasDescriptions ? <div>{v.description}</div> : null}
                  {hasUniqueIDs ? (
                    <code className="small">ID: {v.key}</code>
                  ) : null}
                  {percentages?.[i] !== undefined ? (
                    <div className="text-right text-muted">
                      Split: {percentages[i].toFixed(0)}%
                    </div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr>
              {variations.map((v, i) => (
                <td
                  key={i}
                  className={`align-middle ${canEditExperiment ? "pb-1" : ""}`}
                  style={{
                    minWidth: "17.5rem",
                    maxWidth: "27rem",
                    width: `${80 / Math.min(variations.length || 1, 4)}rem`,
                    height: "inherit",
                    borderBottom: canEditExperiment ? 0 : undefined,
                  }}
                >
                  <div className="d-flex justify-content-center align-items-center flex-column h-100">
                    {v.screenshots.length > 0 ? (
                      <ScreenshotCarousel
                        key={i}
                        index={i}
                        variation={v}
                        canEditExperiment={canEditExperiment}
                        experiment={experiment}
                        mutate={mutate}
                        maxChildHeight={200}
                      />
                    ) : null}
                  </div>
                </td>
              ))}
            </tr>
            {canEditExperiment && (
              <tr>
                {variations.map((v, i) => (
                  <td key={`b${i}`} className="py-0" style={{ borderTop: 0 }}>
                    <div>
                      <ScreenshotUpload
                        variation={i}
                        experiment={experiment.id}
                        onSuccess={() => mutate()}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VariationsTable;
