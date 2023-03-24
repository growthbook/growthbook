import Link from "next/link";
import {
  ExperimentInterfaceStringDates,
  LegacyVariation,
  Variation,
} from "back-end/types/experiment";
import {
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "back-end/types/visual-changeset";
import React, { FC, Fragment, useEffect, useState } from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import { GBAddCircle, GBEdit } from "../Icons";
import OpenVisualEditorLink from "../OpenVisualEditorLink";
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

const isLegacyVariation = (v: Partial<LegacyVariation>): v is LegacyVariation =>
  !!v.css || v.dom?.length > 0;

const VariationsTable: FC<Props> = ({
  experiment,
  canEdit,
  mutate,
  visualChangesets: _visualChangesets,
}) => {
  const { variations } = experiment;
  const { apiCall } = useAuth();

  const { hasCommercialFeature } = useUser();
  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  const [visualChangesets, setVisualChangesets] = useState<
    VisualChangesetInterface[]
  >(_visualChangesets ?? []);
  const [showVisualChangesetForm, setShowVisualChangesetForm] = useState(false);
  const [isEditingVisualChangeset, setIsEditingVisualChangeset] = useState(
    false
  );

  useEffect(() => {
    setVisualChangesets(_visualChangesets ?? []);
  }, [_visualChangesets]);

  const createVisualChangeset = async ({
    editorUrl,
    urlPatterns,
  }: {
    editorUrl: string;
    urlPatterns: VisualChangesetURLPattern[];
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

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasLegacyVisualChanges = variations.some((v) => isLegacyVariation(v));

  return (
    <div className="w-100">
      <div
        className="w-100"
        style={{
          overflowX: "auto",
        }}
      >
        <table className="table table-bordered">
          <thead>
            <tr>
              {variations.map((v, i) => (
                <th key={i}>{v.name}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr>
              {variations.map((v, i) => (
                <td key={i} scope="col">
                  <span className="text-muted">Id:</span> {v.key}
                </td>
              ))}
            </tr>

            {hasDescriptions && (
              <tr>
                {variations.map((v, i) => (
                  <td key={i} scope="col">
                    <div>{v.description}</div>
                  </td>
                ))}
              </tr>
            )}

            <tr style={{ height: 1 }}>
              {variations.map((v, i) => (
                <td
                  key={i}
                  scope="col"
                  style={{ minWidth: "18rem", height: "inherit" }}
                >
                  <div className="d-flex flex-column h-100">
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
                      <div className="mt-auto">
                        <ScreenshotUpload
                          variation={i}
                          experiment={experiment.id}
                          onSuccess={() => mutate()}
                        />
                      </div>
                    )}
                  </div>
                </td>
              ))}
            </tr>

            {visualChangesets.map((vc, i) => (
              <Fragment key={i}>
                <tr className="bg-light">
                  <td colSpan={variations.length}>
                    <div className="row align-items-center">
                      <div className="col-auto">
                        <div>
                          <strong className="text-muted">Visual Changes</strong>
                        </div>
                      </div>
                      {hasVisualEditorFeature && (
                        <>
                          {experiment.status === "draft" && (
                            <div className="col-auto">
                              <OpenVisualEditorLink
                                id={vc.id}
                                changeIndex={1}
                                visualEditorUrl={vc.editorUrl}
                              />
                            </div>
                          )}
                          <div className="col-auto">
                            {vc.urlPatterns.map((p, j) => (
                              <div key={j}>
                                <small>
                                  {p.include === false ? "Exclude" : "Include"}{" "}
                                  URLs matching:
                                </small>{" "}
                                <code>{p.pattern}</code>
                              </div>
                            ))}
                          </div>
                          <div className="col-auto">
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setIsEditingVisualChangeset(true);
                              }}
                            >
                              <GBEdit />
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                <tr>
                  {variations.map((_v, j) => {
                    const changes = vc.visualChanges[j];
                    const numChanges =
                      (changes?.css ? 1 : 0) +
                      (changes?.domMutations?.length || 0);
                    return <td key={j}>{numChanges} visual changes</td>;
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {isEditingVisualChangeset ? (
        <VisualChangesetModal
          editorUrl={visualChangesets[0].editorUrl}
          urlPatterns={visualChangesets[0].urlPatterns}
          onSubmit={updateVisualChangeset}
          onClose={() => setIsEditingVisualChangeset(false)}
        />
      ) : null}

      {hasLegacyVisualChanges && (
        <div className="alert alert-warning mt-3">
          <Link href={`/experiments/designer/${experiment.id}`}>
            Open Legacy Visual Editor
          </Link>
        </div>
      )}

      {!visualChangesets.length && experiment.status === "draft" && (
        <div className="mt-3">
          {showVisualChangesetForm ? (
            <VisualChangesetModal
              onClose={() => setShowVisualChangesetForm(false)}
              onSubmit={createVisualChangeset}
            />
          ) : (
            <>
              {hasVisualEditorFeature ? (
                <button
                  className="ml-4 btn btn-outline-primary"
                  onClick={() => setShowVisualChangesetForm(true)}
                >
                  <GBAddCircle /> Add Visual Changes
                </button>
              ) : (
                <div className="ml-3">
                  <PremiumTooltip commercialFeature={"visual-editor"}>
                    <div className="ml-1 btn btn-outline-primary disabled">
                      <GBAddCircle /> Add Visual Changes
                    </div>
                  </PremiumTooltip>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VariationsTable;
