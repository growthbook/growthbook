import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import { useState } from "react";
import { PiCaretDown } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import ProjectBadges from "@/components/ProjectBadges";
import Badge from "@/ui/Badge";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { isCloud } from "@/services/env";

type PayloadSecurityMode = "plain" | "ciphered" | "remote";

function getPayloadSecurityMode(
  c: SDKConnectionInterface,
): PayloadSecurityMode {
  if (c.remoteEvalEnabled) return "remote";
  if (c.encryptPayload || c.hashSecureAttributes) return "ciphered";
  return "plain";
}

function payloadSecurityLabel(mode: PayloadSecurityMode): string {
  if (mode === "remote") return "Remote Eval";
  if (mode === "ciphered") return "Ciphered";
  return "Plain Text";
}

export type SDKConnectionEditSection = "overview" | "settings";

export default function ConnectionDiagram({
  connection,
  canUpdate,
  showConnectionTitle = false,
  onEdit,
  onEditSection,
}: {
  connection: SDKConnectionInterface;
  canUpdate: boolean;
  showConnectionTitle?: boolean;
  onEdit?: () => void;
  onEditSection?: (section: SDKConnectionEditSection) => void;
}) {
  const handleEdit = (section: SDKConnectionEditSection) => {
    if (onEditSection) {
      onEditSection(section);
    } else if (onEdit) {
      onEdit();
    }
  };
  const editEnabled = canUpdate && (!!onEdit || !!onEditSection);
  const { projects } = useDefinitions();

  // On self-hosted the per-connection `host` can be empty while the env-derived
  // public URL lands in `hostExternal`, so fall back through both.
  const proxyHost =
    connection?.proxy?.host || connection?.proxy?.hostExternal || "";
  const proxyConfigured = !!connection?.proxy?.enabled || !!proxyHost;

  const environments = useEnvironments();
  const environment = environments.find(
    (e) => e.id === connection?.environment,
  );

  const envProjects = environment?.projects ?? [];
  const filteredProjectIds = filterProjectsByEnvironment(
    connection?.projects ?? [],
    environment,
    true,
  );
  const showAllEnvironmentProjects =
    (connection?.projects?.length ?? 0) === 0 && filteredProjectIds.length > 0;
  const disallowedProjects = getDisallowedProjects(
    projects,
    connection?.projects ?? [],
    environment,
  );
  const disallowedProjectIds = disallowedProjects.map((p) => p.id);
  const filteredProjectIdsWithDisallowed = [
    ...filteredProjectIds,
    ...disallowedProjectIds,
  ];

  // Streaming is a derived capability (Cloud or a configured proxy), shown
  // only when actually usable.
  const canStream = isCloud() || !!connection?.proxy?.enabled;

  const proxyDegraded =
    proxyConfigured &&
    !!connection?.proxy?.host &&
    !connection?.proxy?.connected;
  const overallStatus: "connected" | "error" | "waiting" = !connection.connected
    ? "waiting"
    : proxyDegraded
      ? "error"
      : "connected";

  const payloadMode = getPayloadSecurityMode(connection);

  return (
    <Box
      mb="4"
      style={{
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-a5)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      {(showConnectionTitle || editEnabled) && (
        <Flex
          align="center"
          justify="between"
          gap="2"
          px="4"
          py="3"
          style={{ borderBottom: "1px solid var(--gray-a5)" }}
        >
          <Flex align="center" gap="2">
            {showConnectionTitle && (
              <h2
                className="mb-0"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: "-0.005em",
                }}
              >
                Connection
              </h2>
            )}
            <ConnectionStatusBadge status={overallStatus} />
          </Flex>
          {editEnabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEdit("overview")}
            >
              Edit
            </Button>
          )}
        </Flex>
      )}

      {/* Serves row */}
      <Flex
        align="center"
        gap="5"
        wrap="wrap"
        px="4"
        py="3"
        style={{ minHeight: 52 }}
      >
        <Flex align="center" gap="3">
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--gray-11)",
            }}
          >
            Serves
          </span>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 16,
              background: "var(--gray-a6)",
            }}
          />
        </Flex>
        <MetaItem
          label="Environment"
          value={
            <Badge
              color="gray"
              variant="soft"
              radius="medium"
              label={connection.environment}
            />
          }
        />
        {(projects.length > 0 || connection.projects.length > 0) && (
          <MetaItem
            label="Projects"
            value={
              showAllEnvironmentProjects ? (
                <Badge
                  color="teal"
                  variant="soft"
                  radius="medium"
                  label={`All env projects (${envProjects.length})`}
                />
              ) : (
                <ProjectBadges
                  projectIds={
                    filteredProjectIdsWithDisallowed.length
                      ? filteredProjectIdsWithDisallowed
                      : undefined
                  }
                  invalidProjectIds={disallowedProjectIds}
                  invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                  resourceType="sdk connection"
                />
              )
            }
          />
        )}
      </Flex>

      {/* Connection middle: inline SDK · (Proxy) · API Host */}
      <Box px="4" py="3" style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Flex align="center" gap="6" wrap="wrap">
          <MetaItem
            label={connection.languages.length > 1 ? "SDKs" : "SDK"}
            value={
              <Flex align="center" gap="2" wrap="wrap">
                {connection.languages.map((language) => (
                  <SdkPill key={language}>
                    <SDKLanguageLogo
                      showLabel={true}
                      language={language}
                      size={16}
                      version={
                        connection.languages?.length === 1
                          ? connection.sdkVersion
                          : undefined
                      }
                    />
                  </SdkPill>
                ))}
              </Flex>
            }
          />

          {proxyConfigured && (
            <MetaItem
              label="Proxy"
              value={
                <Flex align="center" gap="2" wrap="wrap">
                  <SdkPill>
                    <ClickToCopy compact>{proxyHost}</ClickToCopy>
                  </SdkPill>
                  {!connection?.proxy?.enabled && (
                    <Badge
                      color="red"
                      variant="solid"
                      radius="medium"
                      label="Disabled"
                      title="Proxy was disabled for too many consecutive failures"
                    />
                  )}
                </Flex>
              }
            />
          )}

          <MetaItem
            label="API Host"
            value={
              <SdkPill>
                <ClickToCopy compact>{getApiBaseUrl()}</ClickToCopy>
              </SdkPill>
            }
          />
        </Flex>
      </Box>

      {/* Settings group header with a single Edit */}
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        style={{
          borderTop: "1px solid var(--gray-a5)",
          background: "var(--gray-a1)",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--gray-12)",
          }}
        >
          Settings
        </span>
        {editEnabled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEdit("settings")}
          >
            Edit
          </Button>
        )}
      </Flex>

      {/* Settings sections */}
      <SettingsSection
        title="Delivery & Security"
        summary={
          canStream
            ? `${payloadSecurityLabel(payloadMode)} · Streaming Enabled`
            : payloadSecurityLabel(payloadMode)
        }
        canEdit={false}
        items={[
          {
            label: "Payload Security",
            on: payloadMode !== "plain",
            value: payloadSecurityLabel(payloadMode),
          },
          // Streaming is a derived capability — only show it when usable.
          ...(canStream
            ? [
                {
                  label: "Streaming Updates",
                  on: true,
                  value: "Enabled",
                },
              ]
            : []),
        ]}
      />

      <SettingsSection
        title="Features & Experiments"
        canEdit={false}
        items={[
          {
            label: "Rule IDs",
            on: !!connection.includeRuleIds,
            detail: "Include feature rule IDs in payload",
          },
          {
            label: "Visual Editor",
            on: !!connection.includeVisualExperiments,
          },
          {
            label: "URL Redirects",
            on: !!connection.includeRedirectExperiments,
          },
          {
            label: "Draft Experiments",
            on: !!connection.includeDraftExperiments,
          },
          {
            label: "Experiment Names",
            on: !!connection.includeExperimentNames,
          },
        ]}
      />

      <SettingsSection
        title="Payload Metadata"
        canEdit={false}
        items={[
          {
            label: "Tags in Metadata",
            on: !!connection.includeTagsInMetadata,
          },
          {
            label: "Project IDs in Metadata",
            on: !!connection.includeProjectIdInMetadata,
          },
          {
            label: "Saved Group References",
            on: !!connection.savedGroupReferencesEnabled,
          },
          {
            label: "Custom Fields",
            on: !!connection.includeCustomFieldsInMetadata,
            detail: connection.allowedCustomFieldsInMetadata?.length
              ? `${connection.allowedCustomFieldsInMetadata.length} included`
              : undefined,
          },
        ]}
      />
    </Box>
  );
}

function ConnectionStatusBadge({
  status,
}: {
  status: "connected" | "error" | "waiting";
}) {
  if (status === "connected") {
    return (
      <Badge color="teal" variant="soft" radius="full" label="Connected" />
    );
  }
  if (status === "error") {
    return <Badge color="red" variant="soft" radius="full" label="Error" />;
  }
  return (
    <Badge color="gray" variant="soft" radius="full" label="Not connected" />
  );
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Flex align="center" gap="2">
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--gray-12)",
        }}
      >
        {label}:
      </span>
      <Flex align="center" gap="1">
        {value}
      </Flex>
    </Flex>
  );
}

function SdkPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 12px",
        background: "var(--gray-a2)",
        border: "1px solid var(--gray-a5)",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        color: "var(--gray-12)",
      }}
    >
      {children}
    </span>
  );
}

type SettingItem = {
  label: string;
  on: boolean;
  value?: string;
  detail?: string;
};

function SettingsSection({
  title,
  summary,
  items,
  canEdit,
  onEdit,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  items: SettingItem[];
  canEdit: boolean;
  onEdit?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const onCount = items.filter((i) => i.on).length;
  const offCount = items.length - onCount;
  const summaryText =
    summary ??
    (items.length === 1
      ? items[0].on
        ? "On"
        : "Off"
      : `${onCount} on · ${offCount} off`);

  return (
    <Box style={{ borderTop: "1px solid var(--gray-a5)" }}>
      <Flex
        align="center"
        gap="3"
        px="4"
        py="3"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{
          cursor: "pointer",
          userSelect: "none",
          background: open ? "var(--gray-a2)" : "transparent",
          borderBottom: open ? "1px solid var(--gray-a5)" : undefined,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--gray-12)",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 12.5,
            color: "var(--gray-11)",
          }}
        >
          {summaryText}
        </span>
        <Box style={{ marginLeft: "auto" }}>
          <PiCaretDown
            size={14}
            style={{
              color: "var(--gray-11)",
              transition: "transform 180ms ease",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </Box>
      </Flex>
      {open && (
        <Box px="4" py="3">
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              columnGap: 24,
              rowGap: 16,
            }}
          >
            {items.map((item) => (
              <Flex key={item.label} direction="column" gap="1">
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--gray-12)",
                  }}
                >
                  {item.label}
                </span>
                <Flex align="center" gap="2">
                  <span
                    style={{
                      fontSize: 13,
                      color: item.on ? "var(--gray-12)" : "var(--gray-10)",
                      fontWeight: item.on ? 500 : 400,
                    }}
                  >
                    {item.value ?? (item.on ? "On" : "Off")}
                  </span>
                  {item.detail && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--gray-11)",
                      }}
                    >
                      {item.detail}
                    </span>
                  )}
                </Flex>
              </Flex>
            ))}
          </Box>
          {canEdit && onEdit && (
            <Flex
              justify="end"
              mt="3"
              pt="3"
              style={{ borderTop: "1px solid var(--gray-a4)" }}
            >
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Edit {title} settings
              </Button>
            </Flex>
          )}
        </Box>
      )}
    </Box>
  );
}
