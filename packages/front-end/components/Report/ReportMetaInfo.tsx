import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { useEffect, useState } from "react";
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
import SplitButton from "@/components/Radix/SplitButton";
import {Select, SelectItem} from "@/components/Radix/Select";
import Badge from "@/components/Radix/Badge";
import {date} from "shared/dates";
import {useUser} from "@/services/UserContext";

const APP_ORIGIN =
  (process.env.APP_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";

export default function ReportMetaInfo({
  report,
  mutate,
  canView = true,
  canEdit,
  canDelete,
  showEditControls,
  showPrivateLink,
}: {
  report: ExperimentSnapshotReportInterface;
  mutate?: () => Promise<unknown> | unknown;
  canView?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showEditControls?: boolean;
  showPrivateLink?: boolean;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();

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

  const setShareLevel = async (shareLevel) => {
    await apiCall<{
      updatedReport: ExperimentSnapshotReportInterface;
    }>(`/report/${report.id}`, {
      method: "PUT",
      body: JSON.stringify({ shareLevel }),
    });
    await mutate?.();
  };

  const shareLinkButton = copySuccess ? (
      <Button icon={<PiCheck />}>
        Link copied
      </Button>
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
            <h1>{report.title}</h1>
            {showPrivateLink && (
              <div>
                <LinkButton
                  size="sm"
                  variant="ghost"
                  href={`/report/${report.id}`}
                  icon={<FaGear/>}
                >
                  Manage this report
                </LinkButton>
              </div>
            )}
            {showEditControls && (
              <div>
                <div>
                  <Text size="1" mr="2" color="gray">
                  Created{" "}
                    {report?.userId && <>by {getUserDisplay(report.userId)} </>} on{" "}
                    {date(report.dateCreated)}
                  </Text>
                  {report.status === "published" ? (
                    <Badge variant="solid" label="Published" />
                  ) : (
                    <Badge variant="solid" color="gray" label="Private" />
                  )}
                </div>
              </div>
            )}
          </div>
          {canView ? (
            <div className="flex-shrink-0">
              <div className="d-flex">
                {showEditControls ? (
                  <div className="d-flex flex-column align-items-end">
                    <SplitButton menu={
                      <DropdownMenu
                        menuWidth={300}
                        menuPlacement="end"
                        open={shareDropdownOpen}
                        onOpenChange={(o) => setShareDropdownOpen(o)}
                        trigger={
                          <Button>
                            <PiCaretDownFill/>
                          </Button>
                        }
                      >
                        <Select
                          label="Share Options"
                          value={shareLevel}
                          setValue={setShareLevel}
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
                    }>
                      {shareLinkButton}
                    </SplitButton>
                    <div className="mt-1">
                      <Text size="1" color={shareColor}>
                        {shareIcon}
                        <span className="ml-1">{shareText}</span>
                      </Text>
                    </div>
                  </div>
                ) : shareLinkButton}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
