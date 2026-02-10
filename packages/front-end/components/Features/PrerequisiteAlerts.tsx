import React from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import { FaRegCircleQuestion } from "react-icons/fa6";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import useSDKConnections from "@/hooks/useSDKConnections";

interface Props {
  environments: string[];
  type?: "feature" | "prerequisite";
  project: string;
  size?: "sm" | "md";
  mt?: string;
  mb?: string;
}

export default function PrerequisiteAlerts({
  environments,
  type = "prerequisite",
  project,
  size,
  mt = "0",
  mb = "4",
}: Props) {
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project,
  }).includes("prerequisites");
  const hasSDKWithNoPrerequisites = !getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    mustMatchAllConnections: true,
    project,
  }).includes("prerequisites");

  if (!hasSDKWithNoPrerequisites) {
    return null;
  }

  return (
    <Callout
      size={size}
      status={hasSDKWithPrerequisites ? "warning" : "error"}
      mb={mb}
      mt={mt}
      icon={<FaRegCircleQuestion className="text-warning-orange" />}
    >
      This {type} is in a{" "}
      <span className="text-warning-orange font-weight-bold">
        Schrödinger state
      </span>{" "}
      {environments.length > 1 ? "in some environments" : "in this environment"}{" "}
      and {type === "feature" && "its prerequisites "}must be evaluated at
      runtime.{" "}
      {hasSDKWithPrerequisites ? (
        <>
          However, some of your{" "}
          <Link href="/sdks" target="_blank">
            SDK Connections <PiArrowSquareOut />
          </Link>{" "}
          in this project may not support prerequisite evaluation.
        </>
      ) : (
        <>
          However, none of your{" "}
          <Link href="/sdks" target="_blank">
            SDK Connections <PiArrowSquareOut />
          </Link>{" "}
          in this project support prerequisite evaluation. Either upgrade your
          SDKs or{" "}
          {type === "prerequisite"
            ? "remove this prerequisite"
            : "remove Schrödinger prerequisites"}
          .
        </>
      )}{" "}
      <Tooltip
        body={
          <>
            Prerequisite evaluation is only supported in the following SDKs and
            versions:
            <MinSDKVersionsList capability="prerequisites" />
          </>
        }
      />
    </Callout>
  );
}
