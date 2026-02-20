import React from "react";
import { Flex } from "@radix-ui/themes";
import LinkButton from "@/ui/LinkButton";

export default function ExplorePage() {
  return (
    <div className="p-3 container-fluid pagecontents">
      <Flex justify="between" align="center">
        <h1>Explore</h1>
      </Flex>
      <Flex
        width="100%"
        justify="center"
        align="center"
        height="300px"
        style={{
          border: "2px dashed var(--gray-a3)",
          borderRadius: "var(--radius-4)",
        }}
      >
        <LinkButton href="/product-analytics/explore/new">
          New Exploration
        </LinkButton>
      </Flex>
    </div>
  );
}
