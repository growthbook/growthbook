import React, { FC, PropsWithChildren } from "react";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";
import { SlackIntegrationEditParams } from "@/components/SlackIntegrations/slack-integrations-utils";
import { FaBolt, FaPlug } from "react-icons/fa";
import { SlackIntegrationsListItem } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListItem/SlackIntegrationsListItem";

type SlackIntegrationsListViewProps = {
  onCreateModalOpen: () => void;
  onModalClose: () => void;
  isModalOpen: boolean;
  onAdd: (data: SlackIntegrationEditParams) => void;
  slackIntegrations: SlackIntegrationInterface[];
  errorMessage: string | null;
  createError: string | null;
};

export const SlackIntegrationsListView: FC<SlackIntegrationsListViewProps> = ({
  onAdd,
  onCreateModalOpen,
  onModalClose,
  createError,
  isModalOpen,
  slackIntegrations,
  errorMessage,
}) => {
  return (
    <div>
      {/* TODO: Add/Edit modal */}

      <div className="mb-4">
        <div className="d-flex justify-space-between align-items-center">
          <span className="badge badge-purple text-uppercase mr-2">Beta</span>
          <h1>Slack Integrations</h1>
        </div>
        <p>Get alerts in Slack when your GrowthBook data is updated.</p>
        <div className="alert alert-premium">
          <h4>Free while in Beta</h4>
          <p className="mb-0">
            This feature will be free while we build it out and work out the
            bugs.
          </p>
        </div>
      </div>

      {/* Feedback messages */}
      {errorMessage && (
        <div className="alert alert-danger my-3">{errorMessage}</div>
      )}

      {/* Empty state */}
      {slackIntegrations.length === 0 ? (
        <SlackIntegrationsEmptyState>
          <button className="btn btn-primary">
            <FaPlug className="mr-2" />
            Create a Slack integration
          </button>
        </SlackIntegrationsEmptyState>
      ) : (
        <div>
          {/* List View */}
          {slackIntegrations.map((slackIntegration) => (
            <div key={slackIntegration.id} className="mb-3">
              <SlackIntegrationsListItem
                href={`/integrations/slack/${slackIntegration.id}`}
                slackIntegration={slackIntegration}
              />
            </div>
          ))}

          <div className="mt-4">
            <button className="btn btn-primary" onClick={onCreateModalOpen}>
              <FaPlug className="mr-2" />
              Create a Slack integration
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SlackIntegrationsEmptyState: FC<PropsWithChildren> = ({ children }) => (
  <div className="row">
    <div className="col-xs-12 col-md-6 offset-md-3">
      <div className="card text-center p-3">
        When Slack integrations are created, they will show up here.
        <div className="mt-4">{children}</div>
      </div>
    </div>
  </div>
);

/*export const SlackIntegrationsListViewContainer = () => {
  return (
    <SlackIntegrationsListView />
  )
}*/
