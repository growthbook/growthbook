import React, { useState } from "react";
import { FaAngleRight, FaExclamationTriangle, FaLock } from "react-icons/fa";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsLightningFill } from "react-icons/bs";
import { RxDesktop } from "react-icons/rx";
import { PiShuffle } from "react-icons/pi";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import clsx from "clsx";
import type { SDKLanguage } from "shared/types/sdk-connection";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Box, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import useSDKWebhooks from "@/hooks/useSDKWebhooks";
import StatusCircle from "@/components/Helpers/StatusCircle";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { capitalizeFirstLetter } from "@/services/utils";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import SDKLanguageLogo, {
  getLanguagesByFilter,
  languageMapping,
} from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";
import { SDKLanguageOption } from "./SDKLanguageSelector";

function popularLanguagesFirst(a: SDKLanguage, b: SDKLanguage) {
  const isAPopular = languageMapping[a].filters.includes("popular");
  const isBPopular = languageMapping[b].filters.includes("popular");

  if (isAPopular && !isBPopular) return -1;
  if (!isAPopular && isBPopular) return 1;
  return 0;
}

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();
  const { data: webhooksData, mutate: mutateWebhooks } = useSDKWebhooks();
  const connections = data?.connections ?? [];

  const [modalOpen, setModalOpen] = useState(false);

  const environments = useEnvironments();
  const { projects, project } = useDefinitions();

  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const canCreateSDKConnections =
    permissionsUtil.canViewCreateSDKConnectionModal(project);

  const gb = useGrowthBook();

  let useNewEmptyStateLayout = false;
  if (data && connections.length === 0 && canCreateSDKConnections) {
    useNewEmptyStateLayout = gb.isOn("sdk-connections-new-empty-state");
  }

  const [initialModalSelectedLanguage, setInitialModalSelectedLanguage] =
    useState<SDKLanguage | null>(null);
  const [showAllSdkLanguages, setShowAllSdkLanguages] = useState(false);
  const sdkLanguagesToShow = getLanguagesByFilter(
    showAllSdkLanguages ? "all" : "popular",
  ).sort(popularLanguagesFirst);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const emptyStateContentControl = (
    <Box
      p="5"
      style={{ backgroundColor: "var(--color-panel-solid)" }}
      className="text-center"
    >
      <p>
        <strong>SDK Connections</strong> make it easy to integrate GrowthBook
        into your front-end, back-end, or mobile application.
      </p>
      <Button
        onClick={(e) => {
          e.preventDefault();
          setModalOpen(true);
        }}
      >
        <GBAddCircle /> Create New SDK Connection
      </Button>
    </Box>
  );

  const emptyStateContentExperiment = (
    <Box
      pt="9"
      pb="7"
      px="10%"
      mb="4"
      style={{ backgroundColor: "var(--color-panel-solid)" }}
    >
      <Flex direction="column" align="center">
        <Heading as="h2" size="6" align="center">
          Easily integrate GrowthBook into your app or website
        </Heading>
        <Text size="3" align="center">
          Select one of our SDKs to connect your front-end, back-end or mobile
          app.
        </Text>
      </Flex>

      <Separator size="4" mt="7" mb="6" />

      <Flex
        justify="start"
        direction={{
          initial: "column",
          xs: "row",
        }}
        wrap="wrap"
        gapX="5"
        gapY="4"
        mb="7"
      >
        {sdkLanguagesToShow.map((language) => (
          <SDKLanguageOption
            key={language}
            language={language}
            selected={false}
            onClick={() => {
              setInitialModalSelectedLanguage(language);
              setModalOpen(true);
            }}
          />
        ))}
      </Flex>

      <Flex justify="center">
        <Button
          variant="ghost"
          onClick={() => setShowAllSdkLanguages(!showAllSdkLanguages)}
          size="sm"
        >
          {showAllSdkLanguages ? "Show less" : "Show all"}
        </Button>
      </Flex>
    </Box>
  );

  return (
    <div>
      {modalOpen && (
        <SDKConnectionForm
          initialValue={{
            languages: initialModalSelectedLanguage
              ? [initialModalSelectedLanguage]
              : [],
            sdkVersion: initialModalSelectedLanguage
              ? getLatestSDKVersion(initialModalSelectedLanguage)
              : undefined,
            includeRuleIds: true,
          }}
          close={() => setModalOpen(false)}
          mutate={() => {
            mutate();
            mutateWebhooks();
          }}
          edit={false}
        />
      )}

      <Flex justify="between" align="center" mb="4">
        <Heading size="6" style={{ marginBottom: 0 }}>
          SDK Connections
        </Heading>
        {canCreateSDKConnections &&
        (useNewEmptyStateLayout || connections.length > 0) ? (
          <Button onClick={() => setModalOpen(true)}>Add SDK Connection</Button>
        ) : null}
      </Flex>

      {connections.length === 0 ? (
        <>
          {!canCreateSDKConnections ? (
            <Box
              p="5"
              style={{ backgroundColor: "var(--color-panel-solid)" }}
              className="text-center"
            >
              <p>
                You do not have permission to create SDK connections. Please
                contact your account administrator
              </p>
            </Box>
          ) : useNewEmptyStateLayout ? (
            emptyStateContentExperiment
          ) : (
            emptyStateContentControl
          )}
        </>
      ) : null}

      {connections.length > 0 && (
        <Box mb="3">
          <Table variant="list" stickyHeader roundedCorners>
            <TableHeader>
              <TableRow>
                <TableColumnHeader style={{ width: 25 }} />
                <TableColumnHeader>Name</TableColumnHeader>
                {projects.length > 0 && (
                  <TableColumnHeader>Projects</TableColumnHeader>
                )}
                <TableColumnHeader>Environment</TableColumnHeader>
                <TableColumnHeader>Webhooks</TableColumnHeader>
                <TableColumnHeader className="text-center">
                  Supported Features
                </TableColumnHeader>
                <TableColumnHeader>Language</TableColumnHeader>
                <TableColumnHeader style={{ width: 25 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => {
                const hasProxy =
                  connection.proxy.enabled && !!connection.proxy.host;
                const connected =
                  connection.connected &&
                  (!hasProxy || connection.proxy.connected);

                const environment = environments.find(
                  (e) => e.id === connection.environment,
                );
                const envProjects = environment?.projects ?? [];
                const filteredProjectIds = filterProjectsByEnvironment(
                  connection.projects,
                  environment,
                  true,
                );
                const showAllEnvironmentProjects =
                  connection.projects.length === 0 &&
                  filteredProjectIds.length > 0;
                const disallowedProjects = getDisallowedProjects(
                  projects,
                  connection?.projects ?? [],
                  environment,
                );
                const disallowedProjectIds = disallowedProjects.map(
                  (p) => p.id,
                );
                const filteredProjectIdsWithDisallowed = [
                  ...filteredProjectIds,
                  ...disallowedProjectIds,
                ];

                const webhooks = webhooksData?.connections?.[connection.id];
                const webhooksWithErrors = webhooks?.filter((w) => w.error);

                return (
                  <TableRow
                    key={connection.id}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(`/sdks/${connection.id}`);
                    }}
                  >
                    <TableCell style={{ verticalAlign: "middle", width: 20 }}>
                      <Tooltip
                        body={
                          connected
                            ? "Connected successfully"
                            : "Could not verify the connection"
                        }
                      >
                        {connected ? (
                          <StatusCircle className="bg-success" />
                        ) : (
                          <FaExclamationTriangle className="text-warning" />
                        )}
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-break">
                      <Link href={`/sdks/${connection.id}`}>
                        {connection.name}
                      </Link>
                      {connection.managedBy?.type ? (
                        <div>
                          <Badge
                            label={`Managed by ${capitalizeFirstLetter(
                              connection.managedBy.type,
                            )}`}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    {projects.length > 0 && (
                      <TableCell>
                        {showAllEnvironmentProjects && (
                          <Badge
                            key="All env projects"
                            color="teal"
                            variant="solid"
                            label={`All env projects (${envProjects.length})`}
                          />
                        )}
                        <Flex
                          wrap="wrap"
                          align="center"
                          gap="1"
                          className={clsx({
                            "small mt-1": showAllEnvironmentProjects,
                          })}
                        >
                          {!showAllEnvironmentProjects && (
                            <ProjectBadges
                              projectIds={
                                filteredProjectIdsWithDisallowed.length
                                  ? filteredProjectIdsWithDisallowed
                                  : undefined
                              }
                              invalidProjectIds={disallowedProjectIds}
                              invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                              resourceType="sdk connection"
                              skipMargin={true}
                            />
                          )}
                        </Flex>
                      </TableCell>
                    )}
                    <TableCell>{connection.environment}</TableCell>
                    <TableCell>
                      {webhooks?.length ? (
                        <div style={{ whiteSpace: "nowrap" }}>
                          {webhooks.length} webhook
                          {webhooks.length !== 1 && "s"}
                          {webhooksWithErrors?.length ? (
                            <Tooltip
                              innerClassName="pb-3"
                              usePortal={true}
                              body={
                                <>
                                  {webhooksWithErrors.map((webhook) => (
                                    <Callout
                                      key={webhook.id}
                                      status="error"
                                      my="4"
                                    >
                                      <div>
                                        <strong>{webhook.name}:</strong>
                                      </div>
                                      <div style={{ wordBreak: "break-all" }}>
                                        {webhook.error}
                                      </div>
                                    </Callout>
                                  ))}
                                </>
                              }
                            >
                              <FaExclamationTriangle
                                className="text-danger"
                                style={{ marginLeft: 4 }}
                              />
                            </Tooltip>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      {connection.remoteEvalEnabled && (
                        <Tooltip
                          body={
                            <>
                              <strong>Remote Evaluation</strong> is enabled
                            </>
                          }
                        >
                          <GBRemoteEvalIcon className="mx-1 text-purple" />
                        </Tooltip>
                      )}
                      {connection.hashSecureAttributes && (
                        <Tooltip
                          body={
                            <>
                              <strong>Secure Attribute Hashing</strong> is
                              enabled for this connection&apos;s SDK payload
                            </>
                          }
                        >
                          <GBHashLock className="mx-1 text-blue" />
                        </Tooltip>
                      )}
                      {connection.encryptPayload && (
                        <Tooltip
                          body={
                            <>
                              <strong>Encryption</strong> is enabled for this
                              connection&apos;s SDK payload
                            </>
                          }
                        >
                          <FaLock className="mx-1 text-purple" />
                        </Tooltip>
                      )}
                      {hasProxy && (
                        <Tooltip
                          body={
                            <>
                              <BsLightningFill className="text-warning" />
                              <strong>GB Proxy</strong> is enabled
                            </>
                          }
                        >
                          <BsLightningFill className="mx-1 text-warning" />
                        </Tooltip>
                      )}
                      {connection.includeVisualExperiments && (
                        <Tooltip
                          body={
                            <>
                              <strong>Visual Experiments</strong> are supported
                            </>
                          }
                        >
                          <RxDesktop className="mx-1 text-blue" />
                        </Tooltip>
                      )}
                      {connection.includeRedirectExperiments && (
                        <Tooltip
                          body={
                            <>
                              <strong>URL Redirects</strong> are supported
                            </>
                          }
                        >
                          <PiShuffle className="mx-1 text-blue" />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell style={{ maxWidth: 200 }}>
                      <Flex wrap="wrap" gap="1">
                        {connection.languages.map((language) => (
                          <span key={language} style={{ margin: "0 4px" }}>
                            <SDKLanguageLogo
                              language={language}
                              hideExtra={true}
                              version={
                                connection.languages?.length === 1
                                  ? connection.sdkVersion
                                  : undefined
                              }
                            />
                          </span>
                        ))}
                      </Flex>
                    </TableCell>
                    <TableCell style={{ width: 25 }}>
                      <FaAngleRight />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </div>
  );
}
