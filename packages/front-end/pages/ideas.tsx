import React, { useState } from "react";
import Link from "next/link";
import { IdeaInterface } from "shared/types/idea";
import { FaPlus, FaRegCheckSquare, FaRegSquare } from "react-icons/fa";
import clsx from "clsx";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import IdeaForm from "@/components/Ideas/IdeaForm";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";

const IdeasPage = (): React.ReactElement => {
  const [includeArchived, setIncludeArchived] = useState(false);

  const { project } = useDefinitions();

  const { data, error, mutate } = useApi<{
    ideas: IdeaInterface[];
  }>(`/ideas?project=${project || ""}`);

  const [current, setCurrent] = useState<Partial<IdeaInterface> | null>(null);

  const { getUserDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const { items: displayedIdeas, searchInputProps } = useSearch({
    items: data?.ideas || [],
    searchFields: ["id", "text", "details", "tags"],
    localStorageKey: "ideas",
    defaultSortField: "id",
  });

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const canCreateIdeas = permissionsUtil.canViewIdeaModal(project);

  if (!data.ideas.length) {
    return (
      <div className="container p-4">
        <h1>Ideas</h1>
        <p>This is a space to gather and prioritize experiment ideas.</p>
        <p>
          All you need to get started is a short description - something like
          <em>&quot;Make the signup button blue.&quot;</em>
        </p>
        <p>
          Our proprietary Impact Score calculation helps you objectively
          prioritize ideas.
        </p>
        <p>
          When you&apos;re ready to test an idea, easily convert it to a full
          blown Experiment.
        </p>
        {canCreateIdeas ? (
          <Button
            mt="3"
            onClick={() => {
              setCurrent({});
            }}
          >
            <FaPlus /> Add your first Idea
          </Button>
        ) : null}
        {current && (
          <IdeaForm
            mutate={mutate}
            close={() => setCurrent(null)}
            idea={current}
          />
        )}
      </div>
    );
  }

  const hasArchivedIdeas =
    displayedIdeas.filter((idea) => idea.archived).length > 0;

  return (
    <>
      {current && (
        <IdeaForm
          mutate={mutate}
          close={() => setCurrent(null)}
          idea={current}
        />
      )}
      <div className="contents ideas container-fluid pagecontents">
        <div className="row mb-3 align-items-center">
          <div className="col-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
          {hasArchivedIdeas && (
            <div className="col-auto" style={{ verticalAlign: "middle" }}>
              <small
                className="text-muted text-secondary"
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.preventDefault();
                  setIncludeArchived(!includeArchived);
                }}
              >
                {includeArchived ? <FaRegCheckSquare /> : <FaRegSquare />}{" "}
                Include Archived
              </small>
            </div>
          )}
          <div style={{ flex: 1 }} />
          {canCreateIdeas ? (
            <div className="col-auto">
              <Button
                onClick={() => {
                  setCurrent({});
                }}
              >
                New Idea
              </Button>
            </div>
          ) : null}
        </div>
        <div className="row">
          {displayedIdeas
            .filter((idea) => includeArchived || !idea.archived)
            .map((idea, i) => (
              <div className="col-lg-4 col-md-6 col-sm-12 mb-3" key={i}>
                <div
                  className={clsx("card h-100", {
                    "bg-light": idea.archived,
                  })}
                  style={{
                    wordBreak: "break-word",
                    opacity: idea.archived ? 0.7 : 1,
                  }}
                >
                  <div className="card-body">
                    <div className="d-flex align-items-start h-100">
                      <div
                        style={{ flex: 1 }}
                        className="d-flex flex-column h-100"
                      >
                        <div>
                          {idea.archived && (
                            <div
                              className="text-muted"
                              style={{
                                marginTop: "-10px",
                                marginBottom: 5,
                                fontStyle: "italic",
                              }}
                            >
                              <small>archived</small>
                            </div>
                          )}
                          <h5 className="card-title">
                            <Link href={`/idea/${idea.id}`}>{idea.text}</Link>
                          </h5>
                        </div>
                        <div style={{ flex: 1 }}></div>
                        <div className="lower-card-details text-muted">
                          <div className="date mb-1">
                            By{" "}
                            <strong className="mr-1">
                              {idea.userId
                                ? getUserDisplay(idea.userId)
                                : idea.userName}
                            </strong>
                            on <strong>{date(idea.dateCreated)}</strong>
                          </div>
                          {idea.tags?.length > 0 && (
                            <div className="tags">
                              Tags:{" "}
                              <SortedTags tags={Object.values(idea.tags)} />
                            </div>
                          )}
                        </div>
                      </div>

                      {"impactScore" in idea && idea.impactScore !== null && (
                        <div
                          className="bg-impact text-light py-1 px-2 float-right ml-2 mb-2 text-center h-auto"
                          style={{
                            opacity: (idea.impactScore / 100) * 0.7 + 0.3,
                          }}
                        >
                          <small>impact</small>
                          <div style={{ fontSize: "2.1em", lineHeight: "1em" }}>
                            {idea.impactScore}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
};

export default IdeasPage;
