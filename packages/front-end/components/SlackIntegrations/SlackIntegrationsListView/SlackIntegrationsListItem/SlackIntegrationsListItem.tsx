import React, { FC, useCallback } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { SlackIntegrationEditParams } from "@/components/SlackIntegrations/slack-integrations-utils";

type SlackIntegrationsListItemProps = {
  slackIntegration: SlackIntegrationInterface;
  onDelete: () => Promise<void>;
  onEditModalOpen: (id: string, data: SlackIntegrationEditParams) => void;
  projectsMap: Record<string, string>;
};

export const SlackIntegrationsListItem: FC<SlackIntegrationsListItemProps> = ({
  slackIntegration,
  onDelete,
  onEditModalOpen,
  projectsMap,
}) => {
  const onEdit = useCallback(() => {
    onEditModalOpen(slackIntegration.id, slackIntegration);
  }, [slackIntegration, onEditModalOpen]);

  return (
    <div className="card p-3">
      <div>
        <div className="d-sm-flex justify-content-between">
          {/* Title */}
          <div>
            <h2 className="text-main">{slackIntegration.name}</h2>
          </div>

          <div className="mb-3 mb-sm-0">
            {/* Actions */}
            <button
              onClick={onEdit}
              className="btn btn-sm btn-outline-primary mr-1"
            >
              <FaPencilAlt className="mr-1" />
              Edit
            </button>

            <DeleteButton
              displayName={slackIntegration.name}
              onClick={onDelete}
              outline={true}
              className="btn-sm"
              text="Delete"
            />
          </div>
        </div>
        <p className="text-muted mb-0">
          {slackIntegration.description || <em>(no description)</em>}
        </p>

        <div className="row">
          <div className="col-xs-12 col-md-6">
            {/* Environment */}
            <p className="text-main mt-3 mb-2 font-weight-bold">
              Environment filters
            </p>
            <div className="flex-grow-1  d-flex flex-wrap">
              {slackIntegration.environments.length === 0 ? (
                <span className="text-muted">All environments</span>
              ) : (
                slackIntegration.environments.map((env) => (
                  <span key={env} className="mr-2 badge badge-purple">
                    {env}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="col-xs-12 col-md-6">
            {/* Events */}
            <p className="text-main mt-3 mb-2 font-weight-bold">
              Event filters
            </p>
            <div className="flex-grow-1  d-flex flex-wrap">
              {slackIntegration.events.length === 0 ? (
                <span className="text-muted">All events</span>
              ) : (
                slackIntegration.events.map((eventName) => (
                  <span key={eventName} className="mr-2 badge badge-purple">
                    {eventName}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="row">
          <div className="col-xs-12 col-md-6">
            {/* Tags */}
            <p className="text-main mt-3 mb-2 font-weight-bold">Tag filters</p>
            <div className="flex-grow-1  d-flex flex-wrap">
              {slackIntegration.tags.length === 0 ? (
                <span className="text-muted">All tags</span>
              ) : (
                slackIntegration.tags.map((tag) => (
                  <span key={tag} className="mr-2 badge badge-purple">
                    {tag}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="col-xs-12 col-md-6">
            {/* Projects */}
            <p className="text-main mt-3 mb-2 font-weight-bold">
              Project filters
            </p>
            <div className="flex-grow-1  d-flex flex-wrap">
              {slackIntegration.projects.length === 0 ? (
                <span className="text-muted">All projects</span>
              ) : (
                slackIntegration.projects.map((project) => (
                  <span key={project} className="mr-2 badge badge-purple">
                    {projectsMap[project] || project}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
