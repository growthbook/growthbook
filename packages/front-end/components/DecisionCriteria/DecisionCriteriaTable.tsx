import { FC, useState, MouseEvent } from "react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { FaCheck } from "react-icons/fa";
import { DecisionCriteriaData } from "back-end/types/experiment";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";

interface DecisionCriteriaTableProps {
  defaultCriteriaId: string;
  setDefaultCriteriaId: (id: string) => void;
  decisionCriterias: DecisionCriteriaData[];
  onViewEditClick: (criteria: DecisionCriteriaData) => void;
  onDeleteClick: (criteria: DecisionCriteriaData) => void;
  isEditable: (criteria: DecisionCriteriaData) => boolean;
}

const DecisionCriteriaTable: FC<DecisionCriteriaTableProps> = ({
  defaultCriteriaId,
  setDefaultCriteriaId,
  decisionCriterias,
  onViewEditClick,
  onDeleteClick,
  isEditable,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState("");
  // Prevent dropdown clicks from triggering row click
  const handleDropdownClick = (
    e: MouseEvent,
    criteria: DecisionCriteriaData,
  ) => {
    e.stopPropagation();
    if (dropdownOpen !== criteria.id) {
      setDropdownOpen(criteria.id);
    }
  };

  return (
    <>
      <table className="appbox table gbtable responsive-table decision-criteria-table">
        <thead>
          <tr>
            <th style={{ width: "120px" }}>Org Default</th>
            <th className="w-100">Name</th>
            <th style={{ width: "80px", textAlign: "center" }}>Rules</th>
            <th style={{ width: "40px" }}></th>
            {/* Empty header for actions column */}
          </tr>
        </thead>
        <tbody>
          {decisionCriterias.map((criteria) => (
            <tr
              key={criteria.id}
              className="hover-highlight"
              onClick={() => onViewEditClick(criteria)}
              style={{ cursor: "pointer" }}
            >
              <td className="align-middle text-center">
                {defaultCriteriaId === criteria.id && (
                  <FaCheck color="var(--accent-9)" />
                )}
              </td>
              <td className="align-middle">
                <Flex direction="column" gap="1">
                  <Box className="d-flex align-items-center gap-2">
                    <Text weight="bold">{criteria.name}</Text>
                    {isEditable(criteria) && (
                      <Badge
                        label="CUSTOM"
                        color="violet"
                        variant="soft"
                        ml="2"
                      />
                    )}
                  </Box>
                  {criteria.description && (
                    <Text color="gray" size="1">
                      {criteria.description}
                    </Text>
                  )}
                </Flex>
              </td>
              <td className="text-center align-middle">
                {criteria.rules.length}
              </td>
              <td
                className="text-right align-middle"
                onClick={(e) => handleDropdownClick(e, criteria)}
              >
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="3"
                      highContrast
                    >
                      <BsThreeDotsVertical />
                    </IconButton>
                  }
                  open={dropdownOpen === criteria.id}
                  onOpenChange={(o) => {
                    setDropdownOpen(o ? criteria.id : "");
                  }}
                >
                  <DropdownMenuItem
                    onClick={() => {
                      onViewEditClick(criteria);
                      setDropdownOpen("");
                    }}
                  >
                    {isEditable(criteria) ? "View/Edit" : "View"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setDefaultCriteriaId(criteria.id);
                      setDropdownOpen("");
                    }}
                    disabled={defaultCriteriaId === criteria.id}
                  >
                    Set as organization default
                  </DropdownMenuItem>

                  {isEditable(criteria) && (
                    <>
                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        color="red"
                        onClick={() => {
                          onDeleteClick(criteria);
                          setDropdownOpen("");
                        }}
                        disabled={defaultCriteriaId === criteria.id}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

export default DecisionCriteriaTable;
