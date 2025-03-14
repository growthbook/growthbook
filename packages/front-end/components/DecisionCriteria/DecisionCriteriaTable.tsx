import { FC, useState, MouseEvent } from "react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { FaCheck } from "react-icons/fa";
import { DecisionCriteriaData } from "back-end/types/experiment";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import Modal from "@/components/Modal";
import Badge from "@/components/Radix/Badge";

interface DecisionCriteriaTableProps {
  defaultCriteriaId: string;
  setDefaultCriteriaId: (id: string) => void;
  selectedCriteria?: DecisionCriteriaData;
  setSelectedCriteria: (criteria: DecisionCriteriaData) => void;
  setDecisionCriteriaModalDisabled: (disabled: boolean) => void;
  setDecisionCriteriaModalOpen: (open: boolean) => void;
  decisionCriterias: DecisionCriteriaData[];
  mutate: () => void;
}

const DecisionCriteriaTable: FC<DecisionCriteriaTableProps> = ({
  defaultCriteriaId,
  setDefaultCriteriaId,
  selectedCriteria,
  setSelectedCriteria,
  setDecisionCriteriaModalDisabled,
  setDecisionCriteriaModalOpen,
  decisionCriterias,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState("");

  // Open modal to view or edit a decision criteria
  const openCriteriaModal = (
    criteria: DecisionCriteriaData,
    disabled: boolean
  ) => {
    setSelectedCriteria(criteria);
    setDecisionCriteriaModalDisabled(disabled);
    setDecisionCriteriaModalOpen(true);
  };

  // Check if a criteria is editable (user created vs. system)
  const isEditable = (criteria: DecisionCriteriaData) => {
    return !criteria.id.startsWith("gbdeccrit_");
  };

  // Handle row click to open the criteria modal
  const handleRowClick = (criteria: DecisionCriteriaData) => {
    openCriteriaModal(criteria, !isEditable(criteria));
  };

  // Prevent dropdown clicks from triggering row click
  const handleDropdownClick = (
    e: MouseEvent,
    criteria: DecisionCriteriaData
  ) => {
    e.stopPropagation();
    if (dropdownOpen !== criteria.id) {
      setDropdownOpen(criteria.id);
    }
  };

  return (
    <>
      <table className="appbox table gbtable responsive-table">
        <thead>
          <tr>
            <th style={{ width: "120px" }}>Org Default</th>
            <th className="w-100">Name</th>
            <th style={{ width: "80px", textAlign: "center" }}>Rules</th>
            <th style={{ width: "40px" }}></th>{" "}
            {/* Empty header for actions column */}
          </tr>
        </thead>
        <tbody>
          {decisionCriterias.map((criteria) => (
            <tr
              key={criteria.id}
              className="hover-highlight"
              onClick={() => handleRowClick(criteria)}
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
                  {isEditable(criteria) ? (
                    <DropdownMenuItem
                      onClick={() => {
                        openCriteriaModal(criteria, false);
                        setDropdownOpen("");
                      }}
                    >
                      View/Edit
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        openCriteriaModal(criteria, true);
                        setDropdownOpen("");
                      }}
                    >
                      View
                    </DropdownMenuItem>
                  )}

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
                          setSelectedCriteria(criteria);
                          setShowDeleteModal(true);
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

      {showDeleteModal && selectedCriteria && (
        <Modal
          header="Delete Decision Criteria"
          trackingEventModalType="delete-decision-criteria"
          open={true}
          close={() => setShowDeleteModal(false)}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            try {
              await apiCall<{ status: number; message?: string }>(
                `/decision-criteria/${selectedCriteria.id}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ id: selectedCriteria.id }),
                }
              );
              mutate();
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <div>
            <p>
              Are you sure you want to delete the <b>{selectedCriteria.name}</b>{" "}
              decision criteria?
            </p>
          </div>
        </Modal>
      )}
    </>
  );
};

export default DecisionCriteriaTable;
