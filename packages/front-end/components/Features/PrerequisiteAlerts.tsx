import React from "react";
import { FaRegCircleQuestion } from "react-icons/fa6";
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
  const prefix = (
    <>
      This {type} is in a{" "}
      <span className="text-warning-orange font-weight-bold">
        Schrödinger state
      </span>{" "}
      {environments.length > 1 ? "in some environments" : "in this environment"}{" "}
      and {type === "feature" && "its prerequisites "}must be evaluated at
      runtime.{" "}
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
          However, some of your SDK Connections in this project may not support
          prerequisite evaluation.
        </>
      }
      noneMessage={
        <>
          {prefix}
          However, none of your SDK Connections in this project support
          prerequisite evaluation. Either upgrade your SDKs or{" "}
          {type === "prerequisite"
            ? "remove this prerequisite"
            : "remove Schrödinger prerequisites"}
          .
        </>
      }
      size={size}
      mt={mt}
      mb={mb}
    />
  );
}
