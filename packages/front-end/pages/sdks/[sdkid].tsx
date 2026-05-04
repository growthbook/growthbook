import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { useRouter } from "next/router";
import React, { useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { BsLightningFill, BsThreeDotsVertical } from "react-icons/bs";
import { PiPencilSimpleFill } from "react-icons/pi";
import { Flex, IconButton } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import SDKConnectionForm from "@/components/Features/SDKConnections/SDKConnectionForm";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import { isCloud } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import PageHead from "@/components/Layout/PageHead";
import SdkWebhooks from "@/components/Features/SDKConnections/SdkWebhooks";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ConnectionDiagram from "@/components/Features/SDKConnections/ConnectionDiagram";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { capitalizeFirstLetter } from "@/services/utils";

export default function SDKConnectionPage() {
  const router = useRouter();
  const { sdkid } = router.query;

  const { data, mutate, error } = useSDKConnections();

  const { apiCall } = useAuth();
  const [modalState, setModalState] = useState<{
    mode: "edit" | "create" | "closed";
    initialValue?: SDKConnectionInterface;
  }>({ mode: "closed" });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const permissionsUtil = usePermissionsUtil();

  const connection: SDKConnectionInterface | undefined =
    data?.connections?.find((conn) => conn.id === sdkid);

  const hasProxy = connection?.proxy?.enabled;

  if (error) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">Invalid SDK Connection id</Callout>
      </div>
    );
  }

  const canDuplicate = permissionsUtil.canCreateSDKConnection(connection);
  const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  const canDelete =
    permissionsUtil.canDeleteSDKConnection(connection) &&
    !connection.managedBy?.type;

  return (
    <div className="contents container pagecontents">
      {modalState.mode !== "closed" && (
        <SDKConnectionForm
          close={() => setModalState({ mode: "closed" })}
          mutate={mutate}
          initialValue={modalState.initialValue}
          edit={modalState.mode === "edit"}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "SDK Connections", href: "/sdks" },
          { display: connection.name },
        ]}
      />

      {connection.managedBy?.type ? (
        <div className="mb-2">
          <Badge
            label={`Managed by ${capitalizeFirstLetter(
              connection.managedBy.type,
            )}`}
          />
        </div>
      ) : null}

      <Flex align="start" justify="between" gap="2" mb="2">
        <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
          <Heading size="x-large" as="h1" mb="0">
            {connection.name}
          </Heading>
        </Flex>
        {(canDelete || canUpdate || canDuplicate) && (
          <Flex align="center" gap="4" pr="2">
            {canUpdate && (
              <Button
                icon={<PiPencilSimpleFill />}
                onClick={() =>
                  setModalState({ mode: "edit", initialValue: connection })
                }
              >
                Edit Connection
              </Button>
            )}
            {(canDuplicate || canDelete) && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <BsThreeDotsVertical size={16} />
                  </IconButton>
                }
                menuPlacement="end"
                open={dropdownOpen}
                onOpenChange={setDropdownOpen}
              >
                {canDuplicate && (
                  <DropdownMenuItem
                    onClick={() => {
                      setModalState({
                        mode: "create",
                        initialValue: connection,
                      });
                      setDropdownOpen(false);
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    {canDuplicate && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      color="red"
                      confirmation={{
                        confirmationTitle: "Delete SDK Connection",
                        cta: "Delete",
                        submit: async () => {
                          await apiCall(`/sdk-connections/${connection.id}`, {
                            method: "DELETE",
                          });
                          mutate();
                          router.push(`/sdks`);
                        },
                        closeDropdown: () => setDropdownOpen(false),
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenu>
            )}
          </Flex>
        )}
      </Flex>

      <ConnectionDiagram
        connection={connection}
        mutate={mutate}
        canUpdate={canUpdate}
        showConnectionTitle={true}
      />

      <div className="row mb-3 align-items-center">
        <div className="flex-1"></div>
        <div className="col-auto">
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <BsLightningFill className="text-warning" />
                  <strong>Streaming Updates</strong> allow you to instantly
                  update any subscribed SDKs when you make any feature changes
                  in GrowthBook. For front-end SDKs, active users will see the
                  changes immediately without having to refresh the page.
                </p>
              </div>
            }
          >
            <BsLightningFill className="text-warning" />
            Streaming Updates:{" "}
            <strong>{isCloud() || hasProxy ? "Enabled" : "Disabled"}</strong>
            <div
              className="text-right text-muted"
              style={{ fontSize: "0.75rem" }}
            >
              What is this? <FaInfoCircle />
            </div>
          </Tooltip>
        </div>
      </div>
      <SdkWebhooks connection={connection} />
      <div className="mt-4">
        <CodeSnippetModal
          connections={data.connections}
          mutateConnections={mutate}
          sdkConnection={connection}
          inline={true}
        />
      </div>
    </div>
  );
}
