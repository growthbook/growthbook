import React, { FC, useCallback, useMemo, useState } from "react";
import pick from "lodash/pick";
import { Box } from "@radix-ui/themes";
import { SlackIntegrationInterface } from "shared/types/slack-integration";
import { TagInterface } from "shared/types/tag";
import {
  SlackIntegrationEditParams,
  SlackIntegrationModalMode,
} from "@/components/SlackIntegrations/slack-integrations-utils";
import { SlackIntegrationsListItem } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListItem/SlackIntegrationsListItem";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { SlackIntegrationAddEditModal } from "@/components/SlackIntegrations/SlackIntegrationAddEditModal/SlackIntegrationAddEditModal";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

type SlackIntegrationsListViewProps = {
  onEditModalOpen: (id: string, data: SlackIntegrationEditParams) => void;
  onModalClose: () => void;
  modalMode: SlackIntegrationModalMode | null;
  onUpdate: (id: string, data: SlackIntegrationEditParams) => void;
  onDelete: (id: string) => Promise<void>;
  slackIntegrations: SlackIntegrationInterface[];
  modalError: string | null;
  errorMessage: string | null;
  tagOptions: TagInterface[];
  environments: string[];
  projects: {
    id: string;
    name: string;
  }[];
};

export const SlackIntegrationsListView: FC<SlackIntegrationsListViewProps> = ({
  onUpdate,
  onDelete,
  onEditModalOpen,
  modalMode,
  onModalClose,
  modalError,
  slackIntegrations,
  errorMessage,
  environments,
  tagOptions,
  projects,
}) => {
  const projectsMap: Record<string, string> = useMemo(() => {
    return projects.reduce((acc, curr) => {
      acc[curr.id] = curr.name;
      return acc;
    }, {});
  }, [projects]);

  return (
    <div>
      {/* Add/Edit modal */}
      {modalMode ? (
        <SlackIntegrationAddEditModal
          mode={modalMode}
          isOpen={true}
          onUpdate={onUpdate}
          error={modalError}
          onClose={onModalClose}
          tagOptions={tagOptions}
          projects={projects}
          environments={environments}
        />
      ) : null}

      <Box mb="4">
        <Heading as="h2" size="md" mb="2">
          Legacy Slack Integrations
        </Heading>
        <Text as="p" color="text-mid">
          These connections continue to send notifications. You can edit or
          delete them here while you move to workspace connections. After
          verifying a new connection, delete the old connection to avoid
          duplicate notifications.
        </Text>
      </Box>

      {/* Feedback messages */}
      {errorMessage && (
        <Callout status="error" my="3">
          {errorMessage}
        </Callout>
      )}

      {slackIntegrations.length > 0 && (
        <div>
          {/* List View */}
          {slackIntegrations.map((slackIntegration) => (
            <div key={slackIntegration.id} className="mb-3">
              <SlackIntegrationsListItem
                onDelete={async () => {
                  await onDelete(slackIntegration.id);
                }}
                projectsMap={projectsMap}
                onEditModalOpen={onEditModalOpen}
                slackIntegration={slackIntegration}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const SlackIntegrationsListViewContainer = () => {
  const { apiCall } = useAuth();

  const [modalMode, setModalMode] = useState<SlackIntegrationModalMode | null>(
    null,
  );

  const handleOnEditModalOpen = useCallback(
    (id: string, data: SlackIntegrationEditParams) => {
      setModalMode({
        mode: "edit",
        data,
        id,
      });
    },
    [],
  );

  const [addEditError, setAddEditError] = useState<null | string>(null);

  const {
    data,
    mutate,
    error: loadError,
  } = useApi<{
    slackIntegrations: SlackIntegrationInterface[];
  }>("/integrations/slack");

  const errorMessage = loadError?.message || null;

  const slackIntegrations = data?.slackIntegrations || [];

  const handleDelete = useCallback(
    async (id: string) => {
      await apiCall<{
        error?: string;
        slackIntegration?: SlackIntegrationInterface;
      }>(`/integrations/slack/${id}`, {
        method: "DELETE",
      });

      await mutate();
    },
    [apiCall, mutate],
  );

  const handleUpdate = useCallback(
    async (id: string, data: SlackIntegrationEditParams) => {
      setAddEditError(null);

      try {
        const response = await apiCall<{
          error?: string;
          slackIntegration?: SlackIntegrationInterface;
        }>(`/integrations/slack/${id}`, {
          method: "PUT",
          body: JSON.stringify(
            pick(data, [
              "name",
              "description",
              "projects",
              "environments",
              "events",
              "tags",
              "slackAppId",
              "slackSigningKey",
              "slackIncomingWebHook",
            ]),
          ),
        });

        if (response.error) {
          setAddEditError(
            `Failed to update Slack integration: ${
              response.error || "Unknown error"
            }`,
          );
        } else {
          setAddEditError(null);
          setModalMode(null);
          mutate();
        }
      } catch (e) {
        setAddEditError(`Failed to update Slack integration: ${e.message}`);
      }
    },
    [apiCall, mutate],
  );

  const environmentSettings = useEnvironments();
  const environments = environmentSettings.map((env) => env.id);

  const { projects, tags } = useDefinitions();

  if (!loadError && slackIntegrations.length === 0) return null;

  return (
    <SlackIntegrationsListView
      slackIntegrations={slackIntegrations}
      modalMode={modalMode}
      onDelete={handleDelete}
      modalError={addEditError}
      onEditModalOpen={handleOnEditModalOpen}
      errorMessage={errorMessage}
      environments={environments}
      projects={projects}
      tagOptions={tags}
      onUpdate={handleUpdate}
      onModalClose={() => setModalMode(null)}
    />
  );
};
