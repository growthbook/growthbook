import { ExperimentResultStatusData } from "shared/types/experiment";
import { HoldoutStage } from "shared/util";
import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import {
  PiArrowClockwise,
  PiCaretDown,
  PiCaretDownFill,
  PiGavelFill,
  PiPencilSimple,
  PiProhibit,
} from "react-icons/pi";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import styles from "./ExperimentActionButtons.module.scss";

export interface Props {
  editResult?: () => void;
  editTargeting?: (() => void) | null;
  isBandit?: boolean;
  runningExperimentStatus?: ExperimentResultStatusData;
  holdoutStage?: HoldoutStage;
  // Redesigned page (standard experiments): one "Actions" dropdown in place
  // of the two buttons, with Start a New Phase added (set in review).
  asMenu?: boolean;
  newPhase?: (() => void) | null;
}

// A menu item with an icon, a name and a line of description under it.
function ActionItem({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuItem
      className={styles.item}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.description}>{description}</span>
      </span>
    </DropdownMenuItem>
  );
}

export default function ExperimentActionButtons({
  editResult,
  editTargeting,
  isBandit,
  runningExperimentStatus,
  holdoutStage,
  asMenu = false,
  newPhase,
}: Props) {
  const runningStatus = runningExperimentStatus?.status;

  const readyForDecision =
    runningStatus === "ship-now" ||
    runningStatus === "ready-for-review" ||
    runningStatus === "scheduled-end-review" ||
    runningStatus === "rollback-now";
  const displayCTAText = () => {
    if (holdoutStage) {
      return holdoutStage === "analysis-period"
        ? "Stop Holdout"
        : "Start Analysis Phase";
    }
    if (readyForDecision) {
      return "Make Decision";
    } else if (isBandit) {
      return "Stop Bandit";
    } else {
      return "Stop Experiment";
    }
  };
  // Not for holdouts (holdoutStage is set for them) or bandits.
  if (asMenu && !holdoutStage && !isBandit) {
    // The menu's first group: the changes that keep it running.
    const adjustItems = (
      <DropdownMenuGroup>
        <ActionItem
          icon={<PiPencilSimple size={16} />}
          title="Make Changes"
          description="Adjust targeting, traffic, or settings"
          onClick={() => editTargeting?.()}
          disabled={!editTargeting}
        />
        <ActionItem
          icon={<PiArrowClockwise size={16} />}
          title="Start a New Phase"
          description="Resets results — analysis starts over"
          onClick={() => newPhase?.()}
          disabled={!newPhase}
        />
      </DropdownMenuGroup>
    );
    const menuProps = {
      menuPlacement: "end" as const,
      // 284px, set in review.
      menuWidth: 284,
      // Soft, as @/ui/Select's menu is: the highlighted item takes a
      // --accent-a4 fill and keeps its text colours (set in review).
      variant: "soft" as const,
      contentClassName: styles.menu,
    };

    // When a decision is recommended, a split button replaces Actions (set
    // in review): the label opens the decision modal (the same one Stop /
    // Make Decision opened), and the caret opens the same menu minus its
    // ending group, which the label now covers. @/ui/SplitButton, as
    // AddLinkedChangeButton uses it, with its filled caret.
    if (readyForDecision) {
      return (
        <SplitButton
          menu={
            <DropdownMenu
              {...menuProps}
              trigger={
                // The filled caret, as the existing split button's menu
                // (AddLinkedChangeButton) has it (set in review).
                <Button aria-label="More actions">
                  <PiCaretDownFill />
                </Button>
              }
            >
              {adjustItems}
            </DropdownMenu>
          }
        >
          {/* A filled icon on the left, as Actions' filled lightning bolt:
            Phosphor's gavel (ph-gavel), filled (set in review). */}
          <Button
            icon={<PiGavelFill />}
            onClick={() => editResult?.()}
            disabled={!editResult}
          >
            Make a Decision
          </Button>
        </SplitButton>
      );
    }

    return (
      <DropdownMenu
        trigger={
          // The caret on the right, in the label, 8px after the text (Radix's
          // button gap at size 2), set by hand.
          // "Make Decision" (set in review; was "Actions"), with no icon
          // (the lightning bolt was removed in review).
          <Button>
            <Flex as="span" align="center" gap="2">
              Make Decision
              <PiCaretDown className={styles.semiboldCaret} />
            </Flex>
          </Button>
        }
        // No group labels ("ADJUST", "END"; removed in review): the
        // separator alone divides the groups.
        {...menuProps}
      >
        {adjustItems}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <ActionItem
            icon={<PiProhibit size={16} />}
            // "Make Decision" once the results call for one, as the button
            // did.
            title={displayCTAText()}
            description="Record the outcome and end it"
            onClick={() => editResult?.()}
            disabled={!editResult}
          />
        </DropdownMenuGroup>
      </DropdownMenu>
    );
  }

  return (
    <div className="d-flex ml-2">
      {!holdoutStage && (
        <Button
          variant={readyForDecision ? "outline" : "solid"}
          mr="3"
          disabled={!editTargeting}
          onClick={() => editTargeting?.()}
        >
          Make Changes
        </Button>
      )}
      <Button
        variant={readyForDecision ? "solid" : "outline"}
        onClick={() => editResult?.()}
        disabled={!editResult}
      >
        {displayCTAText()}
      </Button>
    </div>
  );
}
