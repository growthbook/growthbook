import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { useState } from "react";
import {
  PiBuildingFill,
  PiCaretDownFill,
  PiLink,
  PiGlobeHemisphereWestFill,
  PiLockBold,
  PiCheck,
} from "react-icons/pi";
import { Text } from "@radix-ui/themes";
import { FaGear } from "react-icons/fa6";
import { date } from "shared/dates";
import { useRouter } from "next/router";
import Button from "@/components/Radix/Button";
import { DropdownMenu } from "@/components/Radix/DropdownMenu";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useAuth } from "@/services/auth";
import LinkButton from "@/components/Radix/LinkButton";
import SplitButton from "@/components/Radix/SplitButton";
import { Select, SelectItem } from "@/components/Radix/Select";
import Badge from "@/components/Radix/Badge";
import { useUser } from "@/services/UserContext";
import { GBEdit } from "@/components/Icons";
import Toggle from "@/components/Forms/Toggle";
import HelperText from "@/components/Radix/HelperText";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import EditableH1 from "@/components/Forms/EditableH1";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Markdown from "@/components/Markdown/Markdown";

export default function ReportMetaInfo({
  report,
  mutate,
  canView = true,
  isOwner,
  isAdmin,
  canEdit,
  canDelete,
  showEditControls,
  showPrivateLink,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate?: () => Promise<unknown> | unknown;
  canView?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showEditControls?: boolean;
  showPrivateLink?: boolean;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const router = useRouter();

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(report.title);

  const HOST = globalThis?.window?.location?.origin;
  const shareableLink = report.tinyid
    ? `${HOST}/r/${report.tinyid}`
    : `${HOST}/report/${report.id}`;

  const shareLevel = report.shareLevel || "organization";

  const shareIcon =
    shareLevel === "public" ? (
      <PiGlobeHemisphereWestFill />
    ) : shareLevel === "organization" ? (
      <PiBuildingFill />
    ) : (
      <PiLockBold />
    );
  const shareText =
    shareLevel === "public"
      ? "Viewable by anybody with the link"
      : shareLevel === "organization"
      ? "Viewable by members of my organization"
      : "Shareable link disabled";
  const shareColor =
    shareLevel === "public"
      ? "green"
      : shareLevel === "organization"
      ? "gold"
      : "tomato";

  const saveShareLevel = async (
    shareLevel: "public" | "organization" | "private"
  ) => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ shareLevel }),
    });
    await mutate?.();
  };

  const saveStatus = async (published: boolean) => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: published ? "published" : "private" }),
    });
    await mutate?.();
  };

  const saveTitle = async () => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
    await mutate?.();
  };

  const shareLinkButton = copySuccess ? (
    <Button icon={<PiCheck />}>Link copied</Button>
  ) : (
    <Button
      icon={<PiLink />}
      onClick={() => performCopy(shareableLink)}
      disabled={shareLevel === "private"}
    >
      Copy Link
    </Button>
  );

  return (
    <>
      <div className="mt-1 mb-4">
        <div className="d-flex align-items-end">
          <div className="flex-1">
            {showEditControls && canEdit ? (
              <div className="d-flex align-items-center mr-3">
                <EditableH1
                  style={{ minWidth: 500, height: 34, padding: "0 8px" }}
                  className="mb-2"
                  editing={editingTitle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  save={saveTitle}
                />
                {!editingTitle ? (
                  <a
                    role="button"
                    className="link-purple ml-3 mb-2"
                    onClick={() => setEditingTitle(true)}
                  >
                    <GBEdit />
                  </a>
                ) : (
                  <Button
                    size="sm"
                    mb="2"
                    ml="3"
                    onClick={async () => {
                      await saveTitle();
                      setEditingTitle(false);
                    }}
                  >
                    Save
                  </Button>
                )}
              </div>
            ) : (
              <h1>{report.title}</h1>
            )}
            {showPrivateLink && (
              <div>
                <LinkButton
                  size="sm"
                  variant="ghost"
                  href={`/report/${report.id}`}
                  icon={<FaGear />}
                >
                  Manage this report
                </LinkButton>
              </div>
            )}
            <div>
              <Text size="1" color="gray">
                Created{" "}
                {showEditControls && report?.userId ? (
                  <>by {getUserDisplay(report.userId)} </>
                ) : null}{" "}
                on {date(report.dateCreated)}
              </Text>
              {showEditControls && (
                <>
                  <div className="d-inline-block ml-2">
                    {report.status === "published" ? (
                      <Badge
                        variant="soft"
                        label="Published"
                        radius="full"
                        style={{ justifyContent: "center", width: 70 }}
                      />
                    ) : (
                      <Badge
                        variant="soft"
                        color="tomato"
                        label="Private"
                        radius="full"
                        style={{ justifyContent: "center", width: 70 }}
                      />
                    )}
                  </div>
                  {isOwner || isAdmin ? (
                    <DropdownMenu
                      trigger={
                        <a role="button" className="link-purple ml-2">
                          <GBEdit />
                        </a>
                      }
                      menuPlacement="end"
                      menuWidth={200}
                    >
                      <label className="font-weight-bold mb-1">
                        Publish report
                      </label>
                      <Toggle
                        id="toggle-published"
                        value={report.status === "published"}
                        setValue={() =>
                          saveStatus(report.status !== "published")
                        }
                      />
                      <div className="mt-2">
                        <HelperText status="info" size="sm">
                          Controls whether this report is discoverable
                        </HelperText>
                      </div>
                    </DropdownMenu>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {canView ? (
            <div className="flex-shrink-0">
              <div className="d-flex">
                {showEditControls ? (
                  <div className="d-flex flex-column align-items-end">
                    <SplitButton
                      menu={
                        <DropdownMenu
                          menuWidth={300}
                          menuPlacement="end"
                          trigger={
                            <Button>
                              <PiCaretDownFill />
                            </Button>
                          }
                        >
                          <Select
                            label="Share Options"
                            value={shareLevel}
                            setValue={saveShareLevel}
                          >
                            <SelectItem value="public">
                              <PiGlobeHemisphereWestFill /> Public
                            </SelectItem>
                            <SelectItem value="organization">
                              <PiBuildingFill /> Organization
                            </SelectItem>
                            <SelectItem value="private">
                              <PiLockBold /> Disabled
                            </SelectItem>
                          </Select>

                          <div className="mt-2 px-2 mb-1">
                            {shareLevel !== "private" ? (
                              <Text size="1" color="gray" wrap="nowrap">
                                {shareableLink}
                              </Text>
                            ) : null}
                            <div className="mt-1">
                              <Text size="1" color={shareColor}>
                                {shareIcon}
                                <span className="ml-1">{shareText}</span>
                              </Text>
                            </div>
                          </div>
                        </DropdownMenu>
                      }
                    >
                      {shareLinkButton}
                    </SplitButton>
                    <div className="mt-1">
                      <Text size="1" color={shareColor}>
                        {shareIcon}
                        <span className="ml-1">{shareText}</span>
                      </Text>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">{shareLinkButton}</div>
                )}
                {showEditControls && (
                  <div className="px-1 ml-2 mt-2">
                    <MoreMenu>
                      {canDelete && (
                        <DeleteButton
                          className="dropdown-item text-danger"
                          useIcon={false}
                          text="Delete report"
                          displayName="Report"
                          deleteMessage="Are you sure you want to delete this report?"
                          additionalMessage="This cannot be undone"
                          onClick={async () => {
                            await apiCall<{ status: number; message?: string }>(
                              `/report/${report.id}`,
                              {
                                method: "DELETE",
                              }
                            );
                            router.push(
                              `/experiment/${report.experimentId}#results`
                            );
                          }}
                        />
                      )}
                    </MoreMenu>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showEditControls && (isOwner || canEdit) ? (
        <div className="mb-4">
          <MarkdownInlineEdit
            value={report.description ?? ""}
            save={async (description) => {
              await apiCall(`/report/${report.id}`, {
                method: "PUT",
                body: JSON.stringify({ description }),
              });
              mutate?.();
            }}
            canCreate={canEdit}
            canEdit={canEdit}
            label="description"
            header="Description"
            headerClassName="h4"
            containerClassName="mb-2"
          />
        </div>
      ) : report.description ? (
        <div className="mb-4">
          <Markdown>{report.description}</Markdown>
        </div>
      ) : null}
    </>
  );
}
