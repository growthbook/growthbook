import React, { ReactNode } from "react";
import { FaAngleRight } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { FeatureValueType } from "shared/types/feature";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

type Props = {
  changeType: "flag" | "visual";
  feature?: { id: string; valueType: FeatureValueType };
  additionalBadge?: ReactNode;
  page?: string;
  changes?: string[];
  vc?: VisualChangesetInterface;
  experiment?: ExperimentInterfaceStringDates;
  canEditVisualChangesets?: boolean;
  deleteVisualChangeset?: (id: string) => void;
  open: boolean;
  children?: ReactNode;
  state?: string;
};

const joinWithOxfordComma = (array) => {
  if (array.length <= 1) {
    return array.join("");
  } else if (array.length === 2) {
    return array.join(" and ");
  } else {
    const allButLast = array.slice(0, -1).join(", ");
    const last = array.slice(-1);
    return `${allButLast}, and ${last}`;
  }
};

export default function LinkedChange({
  changeType,
  feature,
  page,
  changes,
  vc,
  experiment,
  canEditVisualChangesets,
  deleteVisualChangeset,
  additionalBadge,
  open,
  children,
  state,
}: Props) {
  const [expanded, setExpanded] = React.useState(open);
  //if (changeType === "visual" && !vc && !experiment) return null;

  return (
    <Box className="linked-change appbox my-3" p="4" px="5">
      <Collapsible
        trigger={
          <Box>
            <Flex justify="between" gap="3">
              {changeType === "flag" ? (
                <Flex gap="1" direction="column">
                  <Flex gap="3">
                    <Link
                      href={`/features/${feature?.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Heading
                        as="h4"
                        size="small"
                        weight="medium"
                        mb="0"
                        className="d-inline-flex align-items-center"
                      >
                        {feature?.id || "Feature"}
                        <PiArrowSquareOut className="ml-2" />
                      </Heading>
                    </Link>
                    <Box>{additionalBadge}</Box>
                  </Flex>
                  <Box>
                    <Text weight="medium">{feature?.valueType}</Text>
                  </Box>
                </Flex>
              ) : (
                <>
                  <Flex gap="1" direction="column" flexGrow="1">
                    <Heading
                      as="h4"
                      size="small"
                      weight="medium"
                      mb="0"
                      className="d-inline-flex align-items-center"
                    >
                      {page}
                    </Heading>
                    <Flex gap="3">
                      {canEditVisualChangesets &&
                        experiment?.status === "draft" &&
                        vc && (
                          <Box onClick={(e) => e.stopPropagation()}>
                            <OpenVisualEditorLink
                              visualChangeset={vc}
                              useLink={true}
                              button={
                                <>
                                  <Text weight="medium">
                                    Launch Visual Editor
                                  </Text>
                                  <PiArrowSquareOut
                                    className="ml-2"
                                    style={{
                                      position: "relative",
                                      top: "-2px",
                                    }}
                                  />
                                </>
                              }
                            />
                          </Box>
                        )}
                      <Box>&middot;</Box>
                      <Box className="text-muted">
                        {(changes?.length || 0) > 0
                          ? joinWithOxfordComma(changes) + " changes"
                          : "no changes"}
                      </Box>
                    </Flex>
                  </Flex>

                  <Flex gap="3">
                    {changeType === "visual" &&
                      vc?.id &&
                      deleteVisualChangeset && (
                        <Box onClick={(e) => e.stopPropagation()}>
                          <DeleteButton
                            className="btn-sm ml-4"
                            useRadix={true}
                            text="Delete"
                            stopPropagation={true}
                            onClick={() => {
                              deleteVisualChangeset(vc.id);
                            }}
                            displayName="Visual Changes"
                          />
                        </Box>
                      )}
                    {!expanded && (
                      <>
                        <Button variant="ghost">Edit details</Button>
                      </>
                    )}
                    {canEditVisualChangesets && vc && (
                      <Box onClick={(e) => e.stopPropagation()}>
                        <OpenVisualEditorLink
                          visualChangeset={vc}
                          useLink={true}
                          button={
                            <Button variant="soft">Launch Visual Editor</Button>
                          }
                        />
                      </Box>
                    )}
                  </Flex>
                </>
              )}
              <Box>
                <Button variant="ghost">
                  <FaAngleRight className="chevron" />
                </Button>
              </Box>
            </Flex>
            {state && state === "draft" && (
              <>
                <Callout status="warning" mt="4">
                  Feature is in <strong>Draft</strong> mode and will not allow
                  experiments to run. Publish Feature from the Feature Flag
                  detail page to start.{" "}
                  <Link
                    href={`/features/${feature?.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Take me there <PiArrowSquareOut className="ml-1" />
                  </Link>
                </Callout>
              </>
            )}
          </Box>
        }
        onOpen={() => {
          setExpanded(true);
        }}
        onClose={() => {
          setExpanded(false);
        }}
        open={open}
        transitionTime={100}
      >
        <Box mt="4" pt="4" style={{ borderTop: "1px solid var(--slate-a4)" }}>
          {children}
        </Box>
      </Collapsible>
    </Box>
  );
}
