import React, { FC } from "react";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";

type SlackIntegrationsListItemProps = {
  slackIntegration: SlackIntegrationInterface;
};

export const SlackIntegrationsListItem: FC<SlackIntegrationsListItemProps> = ({
  slackIntegration,
}) => {
  return (
    <div className="card p-3">
      <div>
        <h2 className="text-main">{slackIntegration.name}</h2>
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
    </div>
  );
};
