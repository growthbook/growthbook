import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import Link from "next/link";
import { PiArrowLeft } from "react-icons/pi";
import MetricExplorer from "./Explorer";

export default function ExploreWorkspace() {
  return (
    <div className="position-relative" style={{ padding: "8px" }}>
      <Flex justify="between" align="center" className="mb-2 px-1">
        <Flex align="center" gap="3">
          <Link
            href="/product-analytics/explore"
            className="text-decoration-none"
          >
            <Flex align="center" gap="2" className="text-muted" mt="1">
              <PiArrowLeft />
              <span>Back to Explore</span>
            </Flex>
          </Link>
        </Flex>
      </Flex>
      <Box width="100%">
        <MetricExplorer />
      </Box>
    </div>
  );
}
