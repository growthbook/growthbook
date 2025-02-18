import React, { ReactNode } from "react";
import { FaAngleRight } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { FeatureValueType } from "back-end/types/feature";
import Link from "next/link";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import Callout from "@/components/Radix/Callout";

type Props = {
  changeType: "flag" | "visual";
  feature?: { id: string; valueType: FeatureValueType };
  additionalBadge?: ReactNode;
  page?: string;
  changes?: string[];
  open: boolean;
  children?: ReactNode;
  state?: string;
};

export default function LinkedChange({
  changeType,
  feature,
  page,
  changes,
  additionalBadge,
  open,
  children,
  state,
}: Props) {
  return (
    <Box className="linked-change appbox my-3" p="4" px="5">
      <Collapsible
        trigger={
          <Box>
            <Flex justify="between">
              {changeType === "flag" ? (
                <Flex gap="1" direction="column">
                  <Flex gap="3">
                    <Link
                      href={`/features/${feature?.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Heading
                        as="h4"
                        size="3"
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
                  <div className="col-auto d-flex align-items-center">
                    <span className="text-muted">Page:</span>{" "}
                    <span
                      className="ml-1 d-inline-block text-ellipsis"
                      style={{ width: 300 }}
                    >
                      {page}
                    </span>
                  </div>
                  <div className="col-auto">
                    <span className="text-muted">Changes:</span>{" "}
                    <span>
                      {(changes?.length || 0) > 0 ? (
                        changes?.join(" + ")
                      ) : (
                        <em>none</em>
                      )}
                    </span>
                  </div>
                </>
              )}
              <Box>
                <FaAngleRight className="chevron" />
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
