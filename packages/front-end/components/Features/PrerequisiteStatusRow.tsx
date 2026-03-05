import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import { FaExclamationCircle, FaQuestion } from "react-icons/fa";
import { Environment } from "shared/types/organization";
import React, { useState } from "react";
import {
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import ValueDisplay from "@/components/Features/ValueDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  PrerequisiteStateResult,
  usePrerequisiteStates,
} from "@/hooks/usePrerequisiteStates";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";

interface Props {
  i: number;
  prerequisite: FeaturePrerequisite;
  feature: FeatureInterface;
  prereqDefaultValue?: string;
  environments: Environment[];
  mutate: () => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
}

export default function PrerequisiteStatusRow({
  i,
  prerequisite,
  feature,
  prereqDefaultValue,
  environments,
  mutate,
  setPrerequisiteModal,
}: Props) {
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canViewFeatureModal(feature.project);
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

  const envs = environments.map((e) => e.id);

  // Fetch prerequisite states from backend with JIT feature loading
  // Note: We don't check !!parentFeature because the backend will JIT load cross-project prerequisites
  const { states: prereqStates, loading: prereqStatesLoading } =
    usePrerequisiteStates({
      featureId: prerequisite.id,
      environments: envs,
      enabled: !!prerequisite.id,
    });

  const defaultValues: Record<string, string> | undefined =
    prereqDefaultValue !== undefined
      ? Object.fromEntries(envs.map((env) => [env, prereqDefaultValue]))
      : undefined;

  return (
    <tr>
      <td className="align-middle pl-3 border-right">
        <div className="d-flex">
          <div className="d-flex flex-1 align-items-center mr-2">
            <span className="uppercase-title text-muted mt-1 mr-2">Prereq</span>
            <a
              className="d-flex align-items-center"
              href={`/features/${prerequisite.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <span
                className="d-inline-block text-ellipsis"
                style={{ maxWidth: 240 }}
              >
                {prerequisite.id}
              </span>
            </a>
          </div>
          <div>
            {canEdit && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                    mt="1"
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                open={open}
                onOpenChange={setOpen}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      setPrerequisiteModal({ i });
                      setOpen(false);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    color="red"
                    confirmation={{
                      confirmationTitle: "Delete Prerequisite",
                      cta: "Delete",
                      submit: async () => {
                        track("Delete Prerequisite", {
                          prerequisiteIndex: i,
                        });
                        await apiCall<{ version: number }>(
                          `/feature/${feature.id}/prerequisite`,
                          {
                            method: "DELETE",
                            body: JSON.stringify({ i }),
                          },
                        );
                        mutate();
                      },
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenu>
            )}
          </div>
        </div>
      </td>
      {envs.length > 0 && (
        <PrerequisiteStatesCols
          prereqStates={prereqStates ?? undefined}
          defaultValues={defaultValues}
          envs={envs}
          loading={prereqStatesLoading}
        />
      )}
      <td />
    </tr>
  );
}

export function PrerequisiteStatesCols({
  prereqStates,
  defaultValues, // "true" | "false" defaultValues will override the UI for the "live" state
  envs,
  isSummaryRow = false,
  loading = false,
}: {
  prereqStates?: Record<string, PrerequisiteStateResult>;
  defaultValues?: Record<string, string>;
  envs: string[];
  isSummaryRow?: boolean;
  loading?: boolean;
}) {
  const featureLabel = isSummaryRow
    ? "The current feature"
    : "This prerequisite";
  return (
    <>
      {envs.map((env) => (
        <td key={env} className="text-center">
          {loading && (
            <Tooltip
              className="cursor-pointer"
              body="Loading prerequisite state..."
            >
              <LoadingSpinner />
            </Tooltip>
          )}
          {!loading &&
            prereqStates?.[env]?.state === "deterministic" &&
            prereqStates?.[env]?.value !== null && (
              <Tooltip
                className="cursor-pointer"
                popperClassName="text-left"
                body={
                  <>
                    <div>
                      {defaultValues?.[env] === undefined && (
                        <>
                          {featureLabel} is{" "}
                          <span className="text-success font-weight-bold">
                            live
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "true" && (
                        <>
                          {featureLabel} is{" "}
                          <span className="text-success font-weight-bold">
                            live
                          </span>{" "}
                          and currently serving{" "}
                          <span className="rounded px-1 bg-light">
                            <ValueDisplay value={"true"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                      {defaultValues?.[env] === "false" && (
                        <>
                          {featureLabel} is currently serving{" "}
                          <span className="rounded px-1 bg-light">
                            <ValueDisplay value={"false"} type="boolean" />
                          </span>{" "}
                          in this environment.
                        </>
                      )}
                    </div>
                  </>
                }
              >
                {defaultValues?.[env] === "false" ? (
                  <FaRegCircleXmark className="text-muted" size={20} />
                ) : (
                  <FaRegCircleCheck className="text-success" size={20} />
                )}
              </Tooltip>
            )}
          {!loading &&
            prereqStates?.[env]?.state === "deterministic" &&
            prereqStates?.[env]?.value === null && (
              <Tooltip
                className="cursor-pointer"
                popperClassName="text-left"
                body={
                  <>
                    <div>
                      {featureLabel} is{" "}
                      <span className="text-gray font-weight-bold">
                        not live
                      </span>{" "}
                      in this environment.
                      {isSummaryRow && (
                        <>
                          {" "}
                          It will evaluate to <code>null</code>.
                        </>
                      )}
                    </div>
                  </>
                }
              >
                <FaRegCircleXmark className="text-muted" size={20} />
              </Tooltip>
            )}
          {!loading && prereqStates?.[env]?.state === "conditional" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={
                isSummaryRow ? (
                  <>
                    {featureLabel} is in a{" "}
                    <span className="text-warning-orange font-weight-bold">
                      Schrödinger state
                    </span>{" "}
                    in this environment. We can&apos;t know whether it is live
                    or not until its prerequisites are evaluated at runtime in
                    the SDK. It may evaluate to <code>null</code> at runtime.
                  </>
                ) : (
                  <>
                    {featureLabel} is in a{" "}
                    <span className="text-warning-orange font-weight-bold">
                      Schrödinger state
                    </span>{" "}
                    in this environment. We can&apos;t know its value until it
                    is evaluated at runtime in the SDK.
                  </>
                )
              }
            >
              <FaRegCircleQuestion className="text-warning-orange" size={20} />
            </Tooltip>
          )}
          {!loading && prereqStates?.[env]?.state === "cyclic" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={<div>Circular dependency detected. Please fix.</div>}
            >
              <FaExclamationCircle className="text-danger" size={20} />
            </Tooltip>
          )}
          {/* No state data is available */}
          {!loading && !prereqStates?.[env] && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={<div>Unable to determine prerequisite state.</div>}
            >
              <FaQuestion className="text-muted" size={20} />
            </Tooltip>
          )}
        </td>
      ))}
    </>
  );
}
