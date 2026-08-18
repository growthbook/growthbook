import { Fragment, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { getReviewSetting } from "shared/util";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import ProjectApprovalRuleModal from "./ProjectApprovalRuleModal";

export default function ProjectApprovalCard({
  project,
  projectName,
}: {
  project: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const { settings, teams, hasCommercialFeature, refreshOrganization } =
    useUser();
  const permissionsUtil = usePermissionsUtil();

  if (!hasCommercialFeature("require-approvals")) return null;

  const rules = Array.isArray(settings.requireReviews)
    ? settings.requireReviews
    : [];
  const isOverride = rules.some(
    (r) => r.projects.length === 1 && r.projects[0] === project,
  );
  const rule = getReviewSetting(rules, { project });
  const required = !!rule?.requireReviewOn;
  const environments = rule?.environments?.length
    ? rule.environments.join(", ")
    : "all environments";
  const approverTeams = (rule?.requiredApproverTeams ?? [])
    .map((id) => (teams ?? []).find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t);

  return (
    <>
      {open && (
        <ProjectApprovalRuleModal
          project={project}
          projectName={projectName}
          close={() => setOpen(false)}
          onSuccess={async () => {
            await refreshOrganization();
            setOpen(false);
          }}
        />
      )}
      <Box className="appbox" px="3" py="2" mb="4">
        <Flex align="center" justify="between" gap="3">
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="sm" color="text-low">
              Approval to publish
            </Text>
            <Text size="sm" weight="medium">
              {required ? `Required in ${environments}` : "Not required"}
            </Text>
            {approverTeams.length > 0 && (
              <Text size="sm" weight="medium">
                · Approver needed from{" "}
                {approverTeams.map((t, i) => (
                  <Fragment key={t.id}>
                    {i > 0 && ", "}
                    <Link href={`/settings/team/${t.id}`}>{t.name}</Link>
                  </Fragment>
                ))}
              </Text>
            )}
            <Badge
              color="gray"
              variant="soft"
              label={isOverride ? "Project override" : "Organization default"}
            />
          </Flex>
          <Button
            variant="ghost"
            size="sm"
            disabled={!permissionsUtil.canManageOrgSettings()}
            onClick={() => setOpen(true)}
          >
            Edit
          </Button>
        </Flex>
      </Box>
    </>
  );
}
