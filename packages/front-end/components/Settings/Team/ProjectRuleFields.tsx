import { FC } from "react";
import { Box } from "@radix-ui/themes";
import { ProjectMemberRole } from "shared/types/organization";
import { roleSupportsEnvLimit } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import EnvironmentCell from "./EnvironmentCell";
import useRoleOptions from "./useRoleOptions";

// One project rule: its role and, for roles that support one, an environment limit.
const ProjectRuleFields: FC<{
  rule: ProjectMemberRole;
  setRule: (rule: ProjectMemberRole) => void;
}> = ({ rule, setRule }) => {
  const { organization } = useUser();
  const roleOptions = useRoleOptions({ includeProjectAdminRole: true });

  const setRole = (role: string) => {
    // The server rejects env restrictions on roles with nothing env-scoped
    setRule(
      roleSupportsEnvLimit(role, organization)
        ? { ...rule, role }
        : { ...rule, role, limitAccessByEnvironment: false, environments: [] },
    );
  };

  return (
    <Table variant="surface" layout="fixed">
      <TableHeader>
        <TableRow>
          <TableColumnHeader width="40%">Role</TableColumnHeader>
          <TableColumnHeader width="60%">Environments</TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow style={{ verticalAlign: "middle" }}>
          <TableCell width="40%">
            <Box width="220px">
              <SelectField
                value={rule.role}
                options={roleOptions}
                onChange={setRole}
                sort={false}
                containerClassName="mb-0"
              />
            </Box>
          </TableCell>
          <TableCell width="60%">
            <EnvironmentCell
              role={rule.role}
              environments={rule.environments}
              limitAccessByEnvironment={rule.limitAccessByEnvironment}
              onChange={(next) => setRule({ ...rule, ...next })}
            />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
};

export default ProjectRuleFields;
