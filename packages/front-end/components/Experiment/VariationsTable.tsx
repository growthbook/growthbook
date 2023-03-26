import Link from "next/link";
import {
  ExperimentInterfaceStringDates,
  LegacyVariation,
  Variation,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import React, { FC, Fragment, useState } from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
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

  const visualChangesets = _visualChangesets || [];

  const [
    editingVisualChangeset,
    setEditingVisualChangeset,
  ] = useState<VisualChangesetInterface | null>(null);

  const updateVisualChangeset = async ({
    id,
    editorUrl,
    urlPatterns,
  }: Partial<VisualChangesetInterface>) => {
    await apiCall(`/visual-changesets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ editorUrl, urlPatterns }),
    });
    mutate();
  };

  const hasDescriptions = variations.some((v) => !!v.description?.trim());
  const hasLegacyVisualChanges = variations.some((v) => isLegacyVariation(v));

  return (
    <div className="w-100">
      <div
        className="w-100 mb-4"
        style={{
          overflowX: "auto",
        }}
      >
        <table className="table table-bordered">
          <thead>
            <tr>
              {variations.map((v, i) => (
                <th
                  key={i}
                  className={`variation with-variation-label variation${i} ${
                    !hasDescriptions ? "with-variation-border-bottom" : "pb-2"
                  }`}
                  style={{ borderBottom: hasDescriptions ? 0 : null }}
                >
                  <span className="label">{v.key}</span>
                  <span className="name">{v.name}</span>
                </th>
              ))}
            </tr>
            {hasDescriptions && (
              <tr>
                {variations.map((v, i) => (
                  <td
                    className={`variation with-variation-border-bottom variation${i} pt-0`}
                    style={{ borderTop: 0 }}
                    key={i}
                    scope="col"
                  >
                    <div>{v.description}</div>
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

          {visualChangesets.map((vc, i) => (
            <Fragment key={i}>
              <div className={`${i !== 0 && "mt-3 pt-3 border-top"}`}>
                {hasVisualEditorFeature && (
                  <div className="px-3">
                    <div className="row mt-1 mb-3 d-flex align-items-end">
                      <div className="col">
                        <label className="mb-1">
                          URL Targeting
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
                        </label>
                        <div className="col-auto px-3 py-2 rounded bg-muted-yellow">
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
                      </div>
                      <div style={{ flex: 1 }} />
                      {hasVisualEditorFeature && experiment.status === "draft" && (
                        <div className="col-auto">
                          <OpenVisualEditorLink
                            id={visualChangesets[i].id}
                            changeIndex={1}
                            visualEditorUrl={visualChangesets[i].editorUrl}
                          />
                          <DeleteButton
                            className="btn-sm ml-4"
                            onClick={async () => {
                              await apiCall(`/visual-changesets/${vc.id}`, {
                                method: "DELETE",
                              });
                              mutate();
                            }}
                            displayName="Visual Changes"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div
                  className="w-100"
                  style={{
                    overflowX: "auto",
                  }}
                >
                  <table
                    className="table table-bordered"
                    style={{ tableLayout: "fixed" }}
                  >
                    <thead>
                      <tr>
                        {variations.map((v, i) => (
                          <th
                            key={i}
                            className={`py-2 variation with-variation-label variation${i} with-variation-border-bottom`}
                            style={{ borderBottomWidth: 4, minWidth: 180 }}
                          >
                            <span className="label">{v.key}</span>
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
                            <td key={j} className="px-4 py-2">
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
          ))}
        </div>
      )}

      {editingVisualChangeset ? (
        <VisualChangesetModal
          visualChangeset={editingVisualChangeset}
          onSubmit={updateVisualChangeset}
          onClose={() => setEditingVisualChangeset(null)}
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
