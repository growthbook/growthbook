import React, { ReactElement, useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import {
  FaCheck,
  FaExclamationTriangle,
  FaInfoCircle,
  FaPaperPlane,
} from "react-icons/fa";
import { ago } from "shared/dates";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import useApi from "@/hooks/useApi";
import EditSDKWebhooksModal, {
  CreateSDKWebhookModal,
} from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Radix/Button";
import OldButton from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ClickToReveal from "@/components/Settings/ClickToReveal";

const payloadFormatLabels: Record<string, string | ReactElement> = {
  standard: "Standard",
  "standard-no-payload": (
    <>
      标准
      <br />
      (无SDK负载)
    </>
  ),
  sdkPayload: "仅SDK负载",
  edgeConfig: "Vercel边缘配置",
  none: "无",
};

export default function SdkWebhooks({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/sdk-connections/${connection.id}/webhooks`
  );

  const [createWebhookModalOpen, setCreateWebhookModalOpen] = useState(false);

  const [
    editWebhookData,
    setEditWebhookData,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const canCreateWebhooks = permissionsUtil.canCreateSDKWebhook(connection);
  const canUpdateWebhook = permissionsUtil.canUpdateSDKWebhook(connection);
  const canDeleteWebhook = permissionsUtil.canDeleteSDKWebhook(connection);
  const hasWebhooks = !!data?.webhooks?.length;
  const disableWebhookCreate =
    !canCreateWebhooks ||
    (hasWebhooks && !hasCommercialFeature("multiple-sdk-webhooks"));

  const renderTableRows = () => {
    // only render table if there is data to show
    return data?.webhooks?.map((webhook) => (
      <tr key={webhook.name}>
        <td style={{ minWidth: 150 }}>{webhook.name}</td>
        <td
          style={{
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          <code className="text-main small">{webhook.endpoint}</code>
        </td>
        <td className="small">{webhook.httpMethod}</td>
        <td className="small">
          {payloadFormatLabels?.[webhook?.payloadFormat ?? "standard"]}
        </td>
        <td className="nowrap">
          {webhook.signingKey ? (
            <ClickToReveal
              valueWhenHidden="wk_abc123def456ghi789"
              getValue={async () => webhook.signingKey}
            />
          ) : (
            <em className="text-muted">隐藏</em>
          )}
        </td>
        <td>
          {webhook.error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> 错误
              </span>
              <Tooltip
                className="ml-1"
                innerClassName="pb-1"
                usePortal={true}
                body={
                  <>
                    <div className="alert alert-danger mt-2">
                      {webhook.error}
                    </div>
                  </>
                }
              />
            </>
          ) : webhook.lastSuccess ? (
            <em className="small">
              <FaCheck className="text-success" /> {ago(webhook.lastSuccess)}
            </em>
          ) : (
            <em>从未触发</em>
          )}
        </td>
        <td>
          <OldButton
            color="outline-primary"
            className="btn-sm"
            style={{ width: 80 }}
            disabled={!canUpdateWebhook}
            onClick={async () => {
              await apiCall(`/sdk-webhooks/${webhook.id}/test`, {
                method: "post",
              });
              mutate();
            }}
          >
            <FaPaperPlane className="mr-1" />
            测试
          </OldButton>
        </td>
        <td className="px-0">
          <div className="col-auto mr-1">
            <MoreMenu>
              {canUpdateWebhook ? (
                <button
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditWebhookData(webhook);
                  }}
                >
                  编辑
                </button>
              ) : null}
              {canDeleteWebhook ? (
                <DeleteButton
                  className="dropdown-item"
                  displayName="SDK连接"
                  text="删除"
                  useIcon={false}
                  onClick={async () => {
                    await apiCall(`/sdk-webhooks/${webhook.id}`, {
                      method: "DELETE",
                    });
                    mutate();
                  }}
                />
              ) : null}
            </MoreMenu>
          </div>
        </td>
      </tr>
    ));
  };
  const renderAddWebhookButton = () => (
    <>
      <div className="text-muted mb-3">
        参考 <DocLink docSection="sdkWebhooks">文档</DocLink> 获取设置说明
      </div>
      {canCreateWebhooks ? (
        <div className="d-flex align-items-center">
          <Tooltip
            body={
              disableWebhookCreate
                ? "在免费计划中，每个SDK连接只能有一个网络钩子"
                : ""
            }
          >
            <Button
              disabled={disableWebhookCreate}
              onClick={() => setCreateWebhookModalOpen(true)}
            >
              添加网络钩子
            </Button>
          </Tooltip>
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <strong>SDK网络钩子</strong> 会自动通知任何影响此SDK的更改。例如，修改特性或A/B测试将促使网络钩子触发。
                </p>
              </div>
            }
          >
            <span className="text-muted ml-2" style={{ fontSize: "0.75rem" }}>
              这是什么？ <FaInfoCircle />
            </span>
          </Tooltip>
        </div>
      ) : null}
    </>
  );

  const renderTable = () => {
    return (
      <div className="gb-webhook-table-container mb-2">
        <table className="table appbox gbtable mb-0">
          <thead>
            <tr>
              <th>网络钩子</th>
              <th>端点</th>
              <th>方法</th>
              <th style={{ width: 130 }}>格式</th>
              <th>共享密钥</th>
              <th style={{ width: 125 }}>上次成功</th>
              <th></th>
              <th className="px-0" style={{ width: 35 }} />
            </tr>
          </thead>
          <tbody>{renderTableRows()}</tbody>
        </table>
      </div>
    );
  };
  const isEmpty = data?.webhooks?.length === 0;
  return (
    <div className="gb-sdk-connections-webhooks mb-5">
      <h2 className="mb-2">SDK网络钩子</h2>
      {editWebhookData && (
        <EditSDKWebhooksModal
          close={() => setEditWebhookData(null)}
          onSave={mutate}
          current={editWebhookData}
          sdkConnectionId={connection.id}
        />
      )}
      {createWebhookModalOpen && (
        <CreateSDKWebhookModal
          close={() => setCreateWebhookModalOpen(false)}
          onSave={mutate}
          sdkConnectionId={connection.id}
          language={connection.languages?.[0]}
        />
      )}
      {!isEmpty && renderTable()}
      {renderAddWebhookButton()}
    </div>
  );
}
