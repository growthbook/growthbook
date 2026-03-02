import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { useRouter } from "next/router";
import React, { useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { BsLightningFill } from "react-icons/bs";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
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

  const permissionsUtil = usePermissionsUtil();

  const connection: SDKConnectionInterface | undefined =
    data?.connections?.find((conn) => conn.id === sdkid);

  const hasProxy = connection?.proxy?.enabled;

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection) {
    return <div className="alert alert-danger">Invalid SDK Connection id</div>;
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

      <div className="row align-items-center mb-2">
        <h1 className="col-auto mb-0">{connection.name}</h1>
        {canDelete || canUpdate || canDuplicate ? (
          <>
            {canUpdate ? (
              <div className="col-auto ml-auto">
                <a
                  role="button"
                  className="btn btn-outline-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    setModalState({
                      mode: "edit",
                      initialValue: connection,
                    });
                  }}
                >
                  <GBEdit /> Edit
                </a>
              </div>
            ) : null}
            <div className="col-auto">
              <MoreMenu>
                {canDuplicate ? (
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      setModalState({
                        mode: "create",
                        initialValue: connection,
                      });
                    }}
                  >
                    Duplicate
                  </button>
                ) : null}
                {canDelete ? (
                  <DeleteButton
                    className="dropdown-item text-danger"
                    displayName="SDK Connection"
                    text="Delete"
                    useIcon={false}
                    onClick={async () => {
                      await apiCall(`/sdk-connections/${connection.id}`, {
                        method: "DELETE",
                      });
                      mutate();
                      router.push(`/sdks`);
                    }}
                  />
                ) : null}
              </MoreMenu>
            </div>
          </>
        ) : null}
      </div>

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
