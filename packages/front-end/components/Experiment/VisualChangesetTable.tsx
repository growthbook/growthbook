import { FC, Fragment, useCallback, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LegacyVariation,
  Variation,
} from "back-end/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "back-end/types/visual-changeset";
import { FaPencilAlt, FaPlusCircle, FaTimesCircle } from "react-icons/fa";
import Link from "next/link";
import clsx from "clsx";
import track from "@/services/track";
import { GBEdit } from "@/components/Icons";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { appendQueryParamsToURL } from "@/services/utils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutatonsModal from "@/components/Experiment/EditDOMMutationsModal";
import LinkedChange from "@/components/Experiment/LinkedChange";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate: () => void;
  canEditVisualChangesets: boolean;
  setVisualEditorModal: (v: boolean) => void;
  newUi?: boolean;
};

const isLegacyVariation = (v: Partial<LegacyVariation>): v is LegacyVariation =>
  !!v.css || (v?.dom?.length ?? 0) > 0;

const drawChange = ({
  i,
  vc,
  variations,
  experiment,
  hasVisualEditorFeature,
  canEditVisualChangesets,
  setEditingVisualChangeset,
  setEditingVisualChange,
  deleteVisualChangeset,
  simpleUrlPatterns,
  onlySimpleRules,
  regexUrlPatterns,
  newUi,
}: {
  i: number;
  vc: VisualChangesetInterface;
  variations: Variation[];
  experiment: ExperimentInterfaceStringDates;
  hasVisualEditorFeature: boolean;
  canEditVisualChangesets: boolean;
  setEditingVisualChangeset: (vc: VisualChangesetInterface) => void;
  setEditingVisualChange: ({
    visualChange: VisualChange,
    visualChangeIndex: number,
    visualChangeset: VisualChangesetInterface,
  }) => void;
  deleteVisualChangeset: (id: string) => void;
  simpleUrlPatterns: VisualChangesetURLPattern[];
  onlySimpleRules: boolean;
  regexUrlPatterns: VisualChangesetURLPattern[];
  newUi?: boolean;
}) => {
  return (
    <div
      className={clsx({
        "mt-2": newUi || i !== 0,
        "pb-3": newUi,
        "appbox bg-light mx-3 mb-4 py-2": !newUi,
      })}
    >
      <div className="mt-2 px-3">
        <div
          className={`row mt-1 mb-3 d-flex ${
            newUi ? "align-items-start" : "align-items-end"
          }`}
        >
          <div className="col">
            <div className="col-auto px-3 py-2 rounded bg-muted-yellow">
              <label className="d-block mb-1 font-weight-bold">
                URL Targeting
                {canEditVisualChangesets && (
                  <a
                    className="ml-2"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditingVisualChangeset(vc);
                      track("Open visual editor modal", {
                        source: "visual-editor-ui",
                        action: "edit",
                      });
                    }}
                  >
                    <GBEdit />
                  </a>
                )}
              </label>
              {simpleUrlPatterns.length > 0 && (
                <>
                  {!onlySimpleRules && (
                    <div className="uppercase-title mt-1">Simple:</div>
                  )}
                  {simpleUrlPatterns.map((p, j) =>
                    drawUrlPattern(p, j, vc.urlPatterns.length)
                  )}
                </>
              )}
              {regexUrlPatterns.length > 0 && (
                <>
                  <div className="uppercase-title mt-1">Regex:</div>
                  {regexUrlPatterns.map((p, j) =>
                    drawUrlPattern(p, j, vc.urlPatterns.length)
                  )}
                </>
              )}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {canEditVisualChangesets && experiment.status === "draft" && (
            <div className="col-auto">
              {hasVisualEditorFeature && (
                <OpenVisualEditorLink
                  id={vc.id}
                  changeIndex={1}
                  visualEditorUrl={vc.editorUrl}
                />
              )}
              <DeleteButton
                className="btn-sm ml-4"
                onClick={() => deleteVisualChangeset(vc.id)}
                displayName="Visual Changes"
              />
            </div>
          )}
        </div>
      </div>

      <div
        className="w-100 fade-mask-1rem mb-1"
        style={{
          overflowX: "auto",
        }}
      >
        <table
          className="table table-bordered mx-3 mt-0 mb-2 w100-1rem"
          style={{ tableLayout: "fixed", width: "auto" }}
        >
          <thead>
            <tr>
              {variations.map((v, i) => (
                <th
                  key={i}
                  className={`py-2 variation with-variation-label variation${i} with-variation-border-bottom`}
                  style={{ borderBottomWidth: 3 }}
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
                  (changes?.js ? 1 : 0) +
                  (changes?.domMutations?.length || 0);

                // todo: memoize/refactor?
                let editorUrl = vc.editorUrl.trim();
                if (!editorUrl.match(/^http(s)?:/)) {
                  editorUrl = "http://" + editorUrl;
                }
                editorUrl = appendQueryParamsToURL(editorUrl, {
                  [experiment.trackingKey]: j,
                });

                return (
                  <td
                    key={j}
                    className="py-1"
                    style={{
                      minWidth: "17.5rem",
                      width: `${50 / Math.min(variations.length || 1, 4)}rem`,
                    }}
                  >
                    <div className="d-flex justify-content-between mx-2">
                      <div>
                        {canEditVisualChangesets &&
                          experiment.status === "draft" && (
                            <a
                              href="#"
                              className="mr-2"
                              onClick={() =>
                                setEditingVisualChange({
                                  visualChange: changes,
                                  visualChangeIndex: j,
                                  visualChangeset: vc,
                                })
                              }
                            >
                              <FaPencilAlt />
                            </a>
                          )}
                        {numChanges} visual change
                        {numChanges === 1 ? "" : "s"}
                      </div>
                      <div>
                        <a target="_blank" rel="noreferrer" href={editorUrl}>
                          Preview
                        </a>
                      </div>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const drawUrlPattern = (
  p: VisualChangesetURLPattern,
  j: number,
  total: number
) => (
  <span key={j}>
    <code>{p.pattern}</code>
    {!p.include && (
      <Tooltip body="Exclude this pattern" style={{ marginLeft: 2 }}>
        <FaTimesCircle className="mt-1" color={"#e53"} />
      </Tooltip>
    )}
    {j < total - 1 && <span className="mx-1">, </span>}
  </span>
);

export const VisualChangesetTable: FC<Props> = ({
  experiment,
  visualChangesets = [],
  mutate,
  canEditVisualChangesets,
  setVisualEditorModal,
  newUi,
}: Props) => {
  const { variations } = experiment;
  const { apiCall } = useAuth();

  const { hasCommercialFeature } = useUser();
  const hasVisualEditorFeature = hasCommercialFeature("visual-editor");

  const hasAnyPositionMutations = visualChangesets.some((vc) =>
    vc.visualChanges.some(
      (v) => v.domMutations.filter((m) => m.attribute === "position").length > 0
    )
  );

  const [
    editingVisualChangeset,
    setEditingVisualChangeset,
  ] = useState<VisualChangesetInterface | null>(null);

  const [editingVisualChange, setEditingVisualChange] = useState<{
    visualChangeset: VisualChangesetInterface;
    visualChange: VisualChange;
    visualChangeIndex: number;
  } | null>(null);

  const hasLegacyVisualChanges = variations.some((v) => isLegacyVariation(v));

  const deleteVisualChangeset = useCallback(
    async (id: string) => {
      await apiCall(`/visual-changesets/${id}`, {
        method: "DELETE",
      });
      mutate();
      track("Delete visual changeset", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate]
  );

  const updateVisualChange = useCallback(
    async ({
      visualChangeset,
      visualChange,
      index,
    }: {
      visualChangeset: VisualChangesetInterface;
      visualChange: VisualChange;
      index: number;
    }) => {
      const newVisualChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: visualChangeset.visualChanges.map((c, i) =>
          i === index ? visualChange : c
        ),
      };
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(newVisualChangeset),
      });
      mutate();
      track("Delete visual changeset", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate]
  );

  return (
    <>
      {newUi ? (
        <></>
      ) : (
        <div className="mb-2">
          <div className="px-3 h3 mt-3 d-inline-block my-0 align-middle">
            Visual Changes
          </div>

          {hasAnyPositionMutations && (
            <div className="small text-muted">
              This experiment requires at least version 0.26.0 of our Javascript
              SDK
            </div>
          )}
        </div>
      )}

      {visualChangesets.map((vc, i) => {
        const simpleUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "simple")
          .sort((v) => (!v.include ? 1 : -1));
        const regexUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "regex")
          .sort((v) => (!v.include ? 1 : -1));

        const onlySimpleRules =
          simpleUrlPatterns.length > 0 && regexUrlPatterns.length === 0;

        const change = drawChange({
          i,
          vc,
          variations,
          experiment,
          hasVisualEditorFeature,
          canEditVisualChangesets,
          setEditingVisualChangeset,
          setEditingVisualChange,
          deleteVisualChangeset,
          simpleUrlPatterns,
          onlySimpleRules,
          regexUrlPatterns,
          newUi,
        });

        const visualChangeTypesSet: Set<string> = new Set();
        vc.visualChanges.forEach((c) => {
          if (c.domMutations.length > 0) {
            visualChangeTypesSet.add("Copy");
          }
          if (c.css) {
            visualChangeTypesSet.add("CSS");
          }
          if (c.js) {
            visualChangeTypesSet.add("Javascript");
          }
        });

        const visualChangeTypesDict: string[] = ["Copy", "CSS", "Javascript"];
        const visualChangeTypes: string[] = [...visualChangeTypesSet].sort(
          (a, b) =>
            visualChangeTypesDict.indexOf(a) - visualChangeTypesDict.indexOf(b)
        );

        return (
          <Fragment key={i}>
            {newUi ? (
              <LinkedChange
                changeType={"visual"}
                page={vc.editorUrl}
                changes={visualChangeTypes}
                open={experiment.status === "draft"}
              >
                {change}
              </LinkedChange>
            ) : (
              change
            )}
          </Fragment>
        );
      })}

      {canEditVisualChangesets && experiment.status === "draft" ? (
        <div className={`${newUi ? "" : "px-3"} my-2`}>
          {hasVisualEditorFeature ? (
            <button
              className="btn btn-link"
              onClick={() => {
                setVisualEditorModal(true);
                track("Open visual editor modal", {
                  source: "visual-editor-ui",
                  action: "add",
                });
              }}
            >
              <FaPlusCircle className="mr-1" />
              {newUi ? "Visual Editor change" : "Add Visual Editor page"}
            </button>
          ) : (
            <PremiumTooltip commercialFeature={"visual-editor"}>
              <div className="btn btn-link disabled">
                <FaPlusCircle className="mr-1" />
                {newUi ? "Visual Editor change" : "Add Visual Editor page"}
              </div>
            </PremiumTooltip>
          )}
        </div>
      ) : null}

      {hasLegacyVisualChanges && experiment.status === "draft" ? (
        <div className={`alert alert-warning mt-3 ${newUi ? "" : "mx-4"}`}>
          <div className="mb-1">
            Your experiment has changes created with the legacy visual editor
          </div>
          <Link href={`/experiments/designer/${experiment.id}`}>
            Open Legacy Visual Editor
          </Link>
        </div>
      ) : null}

      {editingVisualChangeset ? (
        <VisualChangesetModal
          mode="edit"
          experiment={experiment}
          visualChangeset={editingVisualChangeset}
          mutate={mutate}
          close={() => setEditingVisualChangeset(null)}
        />
      ) : null}

      {editingVisualChange ? (
        <EditDOMMutatonsModal
          visualChange={editingVisualChange.visualChange}
          close={() => setEditingVisualChange(null)}
          onSave={(newVisualChange) =>
            updateVisualChange({
              index: editingVisualChange.visualChangeIndex,
              visualChange: newVisualChange,
              visualChangeset: editingVisualChange.visualChangeset,
            })
          }
        />
      ) : null}
    </>
  );
};
