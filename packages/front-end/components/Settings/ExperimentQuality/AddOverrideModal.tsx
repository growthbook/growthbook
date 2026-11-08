import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { useRouter } from "next/router";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function AddOverrideModal({
  copyFrom: initialCopyFrom,
  overriddenProjects,
  close,
}: {
  // Duplicating starts from this Project's override
  copyFrom: string | null;
  overriddenProjects: string[];
  close: () => void;
}) {
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { projects, getProjectById } = useDefinitions();
  const available = projects.filter(
    (p) =>
      !overriddenProjects.includes(p.id) &&
      permissionsUtil.canUpdateProject(p.id),
  );
  const [project, setProject] = useState("");
  const [start, setStart] = useState(initialCopyFrom ? "copy" : "default");
  const [copyFrom, setCopyFrom] = useState(initialCopyFrom ?? "");

  return (
    <ModalStandard
      open
      trackingEventModalType="experiment-quality-add-override"
      header="Add Project Override"
      cta="Continue"
      ctaEnabled={!!project && (start === "default" || !!copyFrom)}
      close={close}
      submit={async () => {
        await router.push(
          `/settings/experiment-quality/${encodeURIComponent(project)}${
            start === "copy" ? `?from=${encodeURIComponent(copyFrom)}` : ""
          }`,
        );
      }}
    >
      <Box mb="4">
        <Text as="label" weight="semibold">
          Project
        </Text>
        <Box mt="1">
          {available.length ? (
            <Select
              aria-label="Project"
              placeholder="Choose a Project"
              value={project}
              setValue={setProject}
            >
              {available.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <Text color="text-mid">
              Every Project you can edit already has an override.
            </Text>
          )}
        </Box>
      </Box>
      <Text as="div" weight="semibold" mb="2">
        Start from
      </Text>
      <RadioGroup
        value={start}
        setValue={setStart}
        options={[
          {
            value: "default",
            label: "Organization default",
            description: "Then override only the sections that need to differ.",
          },
          {
            value: "copy",
            label: "Copy another Project",
            description: "Takes a one-time copy. Later changes aren't synced.",
          },
        ]}
      />
      {start === "copy" ? (
        <Box mt="3" ml="6">
          <Select
            aria-label="Project to copy"
            placeholder="Choose a Project to copy"
            value={copyFrom}
            setValue={setCopyFrom}
          >
            {overriddenProjects.map((id) => (
              <SelectItem key={id} value={id}>
                {getProjectById(id)?.name ?? id}
              </SelectItem>
            ))}
          </Select>
        </Box>
      ) : null}
    </ModalStandard>
  );
}
