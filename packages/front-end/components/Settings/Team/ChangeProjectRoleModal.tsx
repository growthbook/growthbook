import React, { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ProjectMemberRole } from "shared/types/organization";
import { useDefinitions } from "@/services/DefinitionsContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import EnvironmentCell from "./EnvironmentCell";
import useRoleOptions from "./useRoleOptions";

const ChangeProjectRoleModal: FC<{
  memberName: string;
  projectRole: ProjectMemberRole;
  close: () => void;
  onConfirm: (data: ProjectMemberRole) => Promise<void>;
}> = ({ memberName, projectRole, close, onConfirm }) => {
  const [value, setValue] = useState(projectRole);
  const { getProjectById } = useDefinitions();
  const roleOptions = useRoleOptions({ includeProjectAdminRole: true });

  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header="Change Project Role"
      subheader={
        <>
          Change project role for <strong>{memberName}</strong>.
        </>
      }
      open={true}
      size="lg"
      submit={async () => {
        await onConfirm(value);
      }}
    >
      <Flex align="center" gap="2" mb="2" minHeight="32px">
        <Text weight="medium">
          {getProjectById(value.project)?.name ?? value.project}
        </Text>
        <Text size="sm" color="text-low">
          replaces the All projects rules inside it
        </Text>
      </Flex>
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
                  value={value.role}
                  options={roleOptions}
                  onChange={(role) => setValue({ ...value, role })}
                  sort={false}
                  containerClassName="mb-0"
                />
              </Box>
            </TableCell>
            <TableCell width="60%">
              <EnvironmentCell
                role={value.role}
                environments={value.environments}
                limitAccessByEnvironment={value.limitAccessByEnvironment}
                onChange={(next) => setValue({ ...value, ...next })}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </ModalStandard>
  );
};

export default ChangeProjectRoleModal;
