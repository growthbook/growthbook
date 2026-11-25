import React from "react";
import { FaRegCircleQuestion } from "react-icons/fa6";
import { Trans } from "@lingui/react/macro";
import SDKCapabilityWarning from "./SDKCapabilityWarning";

interface Props {
  environments: string[];
  type?: "feature" | "prerequisite";
  project: string;
  size?: "small" | "medium";
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
  const isFeature = type === "feature";
  const manyEnvironments = environments.length > 1;
  const prefix = (
    <>
      {isFeature ? (
        manyEnvironments ? (
          <Trans>
            This feature is in a{" "}
            <span className="text-warning-orange font-weight-bold">
              Schrödinger state
            </span>{" "}
            in some environments and its prerequisites must be evaluated at
            runtime.
          </Trans>
        ) : (
          <Trans>
            This feature is in a{" "}
            <span className="text-warning-orange font-weight-bold">
              Schrödinger state
            </span>{" "}
            in this environment and its prerequisites must be evaluated at
            runtime.
          </Trans>
        )
      ) : manyEnvironments ? (
        <Trans>
          This prerequisite is in a{" "}
          <span className="text-warning-orange font-weight-bold">
            Schrödinger state
          </span>{" "}
          in some environments and must be evaluated at runtime.
        </Trans>
      ) : (
        <Trans>
          This prerequisite is in a{" "}
          <span className="text-warning-orange font-weight-bold">
            Schrödinger state
          </span>{" "}
          in this environment and must be evaluated at runtime.
        </Trans>
      )}{" "}
    </>
  );

  return (
    <SDKCapabilityWarning
      capability="prerequisites"
      project={project}
      icon={<FaRegCircleQuestion className="text-warning-orange" />}
      someMessage={
        <>
          {prefix}
          <Trans>
            However, some of your SDK Connections in this project may not
            support prerequisite evaluation.
          </Trans>
        </>
      }
      noneMessage={
        <>
          {prefix}
          {type === "prerequisite" ? (
            <Trans>
              However, none of your SDK Connections in this project support
              prerequisite evaluation. Either upgrade your SDKs or remove this
              prerequisite.
            </Trans>
          ) : (
            <Trans>
              However, none of your SDK Connections in this project support
              prerequisite evaluation. Either upgrade your SDKs or remove
              Schrödinger prerequisites.
            </Trans>
          )}
        </>
      }
      size={size}
      mt={mt}
      mb={mb}
    />
  );
}
