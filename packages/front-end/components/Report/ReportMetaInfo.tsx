import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { useEffect, useState } from "react";
import {
  PiBuildingFill,
  PiCaretDown,
  PiLink,
  PiShareFat,
  PiLockBold,
  PiCheck,
} from "react-icons/pi";
import { Text } from "@radix-ui/themes";
import { FaGear } from "react-icons/fa6";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Modal from "@/components/Modal";
import Avatar from "@/components/Radix/Avatar";
import { useAuth } from "@/services/auth";
import LinkButton from "@/components/Radix/LinkButton";

const APP_ORIGIN =
  (process.env.APP_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";

export default function ReportMetaInfo({
  report,
  mutate,
  canView = true,
  canEdit,
  showPrivateLink,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate?: () => Promise<unknown> | unknown;
  canView?: boolean;
  canEdit?: boolean;
  showPrivateLink?: boolean;
}) {
  const { apiCall } = useAuth();

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 600,
  });

  useEffect(() => {
    if (copySuccess && shareDropdownOpen) {
      setTimeout(() => {
        setShareDropdownOpen(false);
      }, 500);
    }
  }, [copySuccess, shareDropdownOpen, setShareDropdownOpen]);

  const shareableLink = report.tinyid
    ? `${APP_ORIGIN}/r/${report.tinyid}`
    : `${APP_ORIGIN}/report/${report.id}`;

  const shareLevel = report.shareLevel || "organization";
  const editLevel = report.editLevel || "organization";

  const shareIcon =
    shareLevel === "public" ? (
      <PiShareFat />
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

  const editLevelText =
    editLevel === "organization"
      ? "Editable by members of my organization"
      : "Editable by me and administrators";

  const setShareLevel = async (shareLevel) => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ shareLevel }),
    });
    await mutate?.();
  };

  const setEditLevel = async (editLevel) => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ editLevel }),
    });
    await mutate?.();
  };

  return (
    <>
      <div className="mt-1 mb-4">
        <div className="d-flex align-items-end">
          <div className="flex-1">
            <h1 className="mb-1">{report.title}</h1>
          </div>
          {canView ? (
            <div className="flex-shrink-0">
              <div className="d-flex">
                <Button
                  color="cyan"
                  icon={shareIcon}
                  style={{
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    marginRight: 1,
                  }}
                  onClick={() => setShareModalOpen(true)}
                >
                  Share
                </Button>
                <DropdownMenu
                  menuPlacement="end"
                  color="cyan"
                  variant="soft"
                  open={shareDropdownOpen}
                  onOpenChange={(o) => setShareDropdownOpen(o)}
                  trigger={
                    <Button
                      color="cyan"
                      style={{
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        paddingLeft: 10,
                        paddingRight: 10,
                      }}
                    >
                      <PiCaretDown />
                    </Button>
                  }
                >
                  <DropdownMenuItem
                    onClick={
                      shareLevel !== "private"
                        ? (e) => {
                            e.preventDefault();
                            performCopy(shareableLink);
                          }
                        : undefined
                    }
                    disabled={shareLevel === "private"}
                  >
                    {copySuccess ? (
                      <Text color="green" weight="medium">
                        <PiCheck className="mr-2" />
                        Link copied
                      </Text>
                    ) : shareLevel !== "private" ? (
                      <Text>
                        <PiLink className="mr-2" />
                        Copy Shareable Link
                      </Text>
                    ) : (
                      <Text color="tomato">
                        <PiLockBold className="mr-2" />
                        Shareable link disabled
                      </Text>
                    )}
                  </DropdownMenuItem>
                  {shareLevel !== "private" && (
                    <div className="mt-2 px-2 pt-2 mb-1 border-top">
                      <Text size="1" color="gray" wrap="nowrap">
                        {shareableLink}
                      </Text>
                      <div className="mt-1">
                        <Text size="1" color={shareColor}>
                          {shareIcon}
                          <span className="ml-1">{shareText}</span>
                        </Text>
                      </div>
                    </div>
                  )}
                </DropdownMenu>
              </div>
            </div>
          ) : null}
        </div>
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
      </div>

      {shareModalOpen && (
        <Modal
          open={true}
          trackingEventModalType="share-report-settings"
          close={() => setShareModalOpen(false)}
          includeCloseCta={false}
          header={`Share "${report.title}"`}
          cta="Done"
          submit={() => setShareModalOpen(false)}
          useRadixButton={true}
          secondaryCTA={
            shareLevel !== "private" ? (
              <>
                {copySuccess ? (
                  <div className="pl-2 ml-2">
                    <Text color="green" weight="medium">
                      <PiCheck className="mr-2" />
                      Link copied
                    </Text>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    color="cyan"
                    icon={<PiLink />}
                    onClick={() => performCopy(shareableLink)}
                  >
                    Copy Shareable Link
                  </Button>
                )}
                <div className="flex-1" />
              </>
            ) : null
          }
        >
          <label>Shareable link access</label>
          <div className="d-flex align-items-center mb-4">
            <Avatar mr="1" color={shareColor}>
              {shareIcon}
            </Avatar>
            <DropdownMenu
              color="cyan"
              variant="soft"
              disabled={!canEdit}
              trigger={
                <Button
                  color={shareColor}
                  variant="ghost"
                  size="sm"
                  iconPosition="right"
                  icon={canEdit ? <PiCaretDown /> : undefined}
                >
                  <span className={!canEdit ? "text-muted" : undefined}>
                    {shareText}
                  </span>
                </Button>
              }
            >
              <DropdownMenuItem onClick={() => setShareLevel("public")}>
                <PiShareFat /> Public
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShareLevel("organization")}>
                <PiBuildingFill /> Organization
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShareLevel("private")}>
                <PiLockBold /> Disabled
              </DropdownMenuItem>
            </DropdownMenu>
          </div>

          <label>Report write access</label>
          <div className="d-flex align-items-center mb-3">
            <Avatar mr="1">
              <FaGear />
            </Avatar>
            <DropdownMenu
              color="cyan"
              variant="soft"
              disabled={!canEdit}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  iconPosition="right"
                  icon={canEdit ? <PiCaretDown /> : undefined}
                >
                  <span className={!canEdit ? "text-muted" : undefined}>
                    {editLevelText}
                  </span>
                </Button>
              }
            >
              <DropdownMenuItem onClick={() => setEditLevel("organization")}>
                <PiBuildingFill /> Organization
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditLevel("private")}>
                <PiLockBold /> Private
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </Modal>
      )}
    </>
  );
}
