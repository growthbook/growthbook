import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React from "react";
import Button from "@/components/Radix/Button";
import {PiBuildingFill, PiCaretDown, PiLink, PiShareFat, PiLockBold, PiCheck} from "react-icons/pi";
import {DropdownMenu, DropdownMenuItem} from "@/components/Radix/DropdownMenu";
import {useCopyToClipboard} from "@/hooks/useCopyToClipboard";
import HelperText from "@/components/Radix/HelperText";
import { Text } from "@radix-ui/themes";

export default function ReportMetaInfo({
  report,
  canEdit,
}: {
  report: ExperimentSnapshotReportInterface;
  canEdit?: boolean;
}) {
  const APP_ORIGIN =
    (process.env.APP_ORIGIN ?? "").replace(/\/$/, "") || "http://localhost:3000";

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 800,
  });
  const shareableLink = report.tinyid ? `${APP_ORIGIN}/r/${report.tinyid}` : `${APP_ORIGIN}/report/${report.id}`;
  const shareLevel = report.shareLevel || "private";
  const editLevel = report.editLevel || "organization";

  const shareIcon =
    shareLevel === "public" ? <PiShareFat /> :
    shareLevel === "organization" ? <PiBuildingFill /> :
    <PiLockBold />;

  return (
    <div className="mb-4">
      <div className="d-flex">
        <div className="flex-1">
          <h1 className="my-0">{report.title}</h1>
        </div>
        <div className="flex-shrink-0">
          <div className="d-flex">
            <Button
              color="cyan"
              icon={shareIcon}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, marginRight: 1 }}
            >
              Share
            </Button>
            <DropdownMenu
              menuPlacement="end"
              color="cyan"
              variant="soft"
              trigger={
                <Button
                  color="cyan"
                  style={{borderTopLeftRadius: 0, borderBottomLeftRadius: 0, paddingLeft: 10, paddingRight: 10}}
                >
                  <PiCaretDown/>
                </Button>
              }
            >
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  performCopy(shareableLink);
                }}
              >
                {copySuccess ? (
                  <Text color="green" weight="medium">
                    <PiCheck className="mr-2" />
                    Link copied
                  </Text>
                ) : (
                  <Text>
                    <PiLink className="mr-2" />
                    Copy Shareable Link
                  </Text>
                )}
              </DropdownMenuItem>
              <div className="mt-2 px-2 pt-2 mb-1 border-top">
                <Text size="1" color="gray" wrap="nowrap">{shareableLink}</Text>
                <HelperText status="info" size="sm" mt="3">
                  {
                    shareLevel === "public" ? "Viewable by anybody with the link" :
                      shareLevel === "organization" ? "Viewable by anybody in my organization" :
                        "Private to me and administrators"
                  }
                </HelperText>
              </div>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
