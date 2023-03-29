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
import React, { FC, Fragment, useState } from "react";
import { FaTimesCircle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import Carousel from "../Carousel";
import ScreenshotUpload from "../EditExperiment/ScreenshotUpload";
import { GBEdit } from "../Icons";
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
        <img
          className="experiment-image"
          key={s.path}
          src={s.path}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: "drop-shadow(0px 4px 15px rgba(0, 0, 0, 0.12))",
          }}
        />
      ))}
    </Carousel>
  );
};

const isLegacyVariation = (v: Partial<LegacyVariation>): v is LegacyVariation =>
  !!v.css || v.dom?.length > 0;

const drawUrlPattern = (
  p: VisualChangesetURLPattern,
  j: number,
  total: number
) => (
  <span key={j}>
    <code>{p.pattern}</code>
    {p.include === false && (
      <Tooltip body="Exclude this pattern" style={{ marginLeft: 2 }}>
        <FaTimesCircle className="mt-1" color={"#e53"} />
      </Tooltip>
    )}
    {j < total - 1 && <span className="mx-1">, </span>}
  </span>
);

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

  const visualChangesets = _visualChangesets || [];

  const [
    editingVisualChangeset,
    setEditingVisualChangeset,
  ] = useState<VisualChangesetInterface | null>(null);

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasUniqueIDs = variations.some((v, i) => v.key !== i + "");
  const hasLegacyVisualChanges = variations.some((v) => isLegacyVariation(v));

  return (
    <div className="w-100">
      <div
        className="w-100 mb-4 fade-mask-1rem"
        style={{
          overflowX: "auto",
        }}
      >
        <table className="table table-bordered mx-3 w100-1rem">
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
                    borderBottom: hasDescriptions || hasUniqueIDs ? 0 : null,
                  }}
                >
                  <span className="label">{i}</span>
                  <span className="name">{v.name}</span>
                </th>
              ))}
            </tr>
            {(hasDescriptions || hasUniqueIDs) && (
              <tr>
                {variations.map((v, i) => (
                  <td
                    className={`variation with-variation-border-bottom variation${i} pt-0 pb-1 align-bottom`}
                    style={{ borderTop: 0 }}
                    key={i}
                    scope="col"
                  >
                    {hasDescriptions && <div>{v.description}</div>}
                    {hasUniqueIDs && <code className="small">ID: {v.key}</code>}
                  </td>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            <tr style={{ height: 1 }}>
              {variations.map((v, i) => (
                <td
                  key={i}
                  scope="col"
                  style={{ minWidth: "17.5rem", height: "inherit" }}
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
          </tbody>
        </table>
      </div>

      {visualChangesets.length > 0 && (
        <div>
          <div className="px-3 mb-3">
            <div className="h3 d-inline-block my-0 align-middle">
              Visual Changes
            </div>
          </div>

          {visualChangesets.map((vc, i) => {
            const simpleUrlPatterns = vc.urlPatterns
              .filter((v) => v.type === "simple")
              .sort((v) => (v.include === false ? 1 : -1));
            const exactUrlPatterns = vc.urlPatterns
              .filter((v) => v.type === "exact")
              .sort((v) => (v.include === false ? 1 : -1));
            const regexUrlPatterns = vc.urlPatterns
              .filter((v) => v.type === "regex")
              .sort((v) => (v.include === false ? 1 : -1));

            const onlySimpleRules =
              simpleUrlPatterns.length > 0 &&
              exactUrlPatterns.length === 0 &&
              regexUrlPatterns.length === 0;
            const onlyExactRules =
              exactUrlPatterns.length > 0 &&
              simpleUrlPatterns.length === 0 &&
              regexUrlPatterns.length === 0;

            return (
              <Fragment key={i}>
                <div className={`${i !== 0 && "mt-2"}`}>
                  {hasVisualEditorFeature && (
                    <div className="px-3">
                      <div className="row mt-1 mb-2 d-flex align-items-end">
                        <div className="col">
                          <label className="mb-1">
                            URL Targeting
                            {canEdit && (
                              <a
                                className="ml-2"
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditingVisualChangeset(vc);
                                }}
                              >
                                <GBEdit />
                              </a>
                            )}
                          </label>
                          <div className="col-auto px-3 py-2 rounded bg-muted-yellow">
                            {simpleUrlPatterns.length > 0 && (
                              <>
                                {!onlySimpleRules && (
                                  <div className="uppercase-title mt-1">
                                    Simple:
                                  </div>
                                )}
                                {simpleUrlPatterns.map((p, j) =>
                                  drawUrlPattern(p, j, vc.urlPatterns.length)
                                )}
                              </>
                            )}
                            {exactUrlPatterns.length > 0 && (
                              <>
                                {!onlyExactRules && (
                                  <div className="uppercase-title mt-1">
                                    Exact:
                                  </div>
                                )}
                                {exactUrlPatterns.map((p, j) =>
                                  drawUrlPattern(p, j, vc.urlPatterns.length)
                                )}
                              </>
                            )}
                            {regexUrlPatterns.length > 0 && (
                              <>
                                <div className="uppercase-title mt-1">
                                  Regex:
                                </div>
                                {regexUrlPatterns.map((p, j) =>
                                  drawUrlPattern(p, j, vc.urlPatterns.length)
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ flex: 1 }} />
                        {hasVisualEditorFeature &&
                          experiment.status === "draft" && (
                            <div className="col-auto">
                              <OpenVisualEditorLink
                                id={vc.id}
                                changeIndex={1}
                                visualEditorUrl={vc.editorUrl}
                              />
                              {canEdit && (
                                <DeleteButton
                                  className="btn-sm ml-4"
                                  onClick={async () => {
                                    await apiCall(
                                      `/visual-changesets/${vc.id}`,
                                      {
                                        method: "DELETE",
                                      }
                                    );
                                    mutate();
                                  }}
                                  displayName="Visual Changes"
                                />
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  )}

                  <div
                    className="w-100 fade-mask-1rem"
                    style={{
                      overflowX: "auto",
                    }}
                  >
                    <table
                      className="table table-borderless mx-3 w100-1rem"
                      style={{ tableLayout: "fixed" }}
                    >
                      <thead>
                        <tr>
                          {variations.map((v, i) => (
                            <th
                              key={i}
                              className={`py-2 variation with-variation-label variation${i} with-variation-border-bottom`}
                              style={{ borderBottomWidth: 3, width: "10rem" }}
                            >
                              <span className="label">{i}</span>
                              <span className="name">{v.name}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {variations.map((_v, j) => {
                            const changes = vc.visualChanges[j];
                            const numChanges =
                              (changes?.css ? 1 : 0) +
                              (changes?.domMutations?.length || 0);
                            return (
                              <td key={j} className="px-4 py-1">
                                {numChanges} visual change
                                {numChanges === 1 ? "" : "s"}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {editingVisualChangeset ? (
        <VisualChangesetModal
          mode="edit"
          experiment={experiment}
          visualChangeset={editingVisualChangeset}
          mutate={mutate}
          close={() => setEditingVisualChangeset(null)}
        />
      ) : null}

      {hasLegacyVisualChanges && (
        <div className="alert alert-warning mt-3">
          <Link href={`/experiments/designer/${experiment.id}`}>
            Open Legacy Visual Editor
          </Link>
        </div>
      )}
    </div>
  );
};

export default VariationsTable;
