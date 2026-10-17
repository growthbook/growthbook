import { ReactNode } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { CommercialFeature } from "shared/enterprise";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiPlus } from "react-icons/pi";
import {
  VARIATION_GRID_COLUMNS,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { DropdownMenu } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";

/** One kind of implementation under the variations, as wide as their grid. */
export function ImplementationSection({
  id,
  cols,
  heading,
  add,
  children,
}: {
  id?: string;
  cols: number;
  heading?: ReactNode;
  // Offered under the last card.
  add?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Flex
      id={id}
      direction="column"
      gap="4"
      mt="4"
      mx="auto"
      width="100%"
      style={{ maxWidth: variationGridMaxWidth(cols) }}
    >
      {heading}
      {children}
      {add ? <Flex justify="end">{add}</Flex> : null}
    </Flex>
  );
}

export function ImplementationCard({ children }: { children: ReactNode }) {
  return (
    <Box className="appbox mb-0" py="3">
      {children}
    </Box>
  );
}

/** What the card is on the left; what describes all of it, and its actions, on the right. */
export function ImplementationCardHeader({
  icon,
  title,
  meta,
  actions,
  menu,
  menuLabel,
}: {
  icon: ReactNode;
  title: ReactNode;
  // Beside the title: a status or a warning.
  meta?: ReactNode;
  actions?: ReactNode;
  menu?: ReactNode;
  menuLabel: string;
}) {
  return (
    <Flex
      align="center"
      gap="3"
      px="3"
      pb="3"
      mb="3"
      wrap="wrap"
      style={{ borderBottom: "1px solid var(--gray-a5)" }}
    >
      <Flex align="center" gap="2" minWidth="0">
        <Flex flexShrink="0" style={{ color: "var(--color-text-low)" }}>
          {icon}
        </Flex>
        {title}
      </Flex>
      {meta}
      <Flex align="center" gap="3" ml="auto">
        {/* Set off from the menu, as on a Feature Flag's card. */}
        <Flex align="center" gap="3" mr={menu ? "2" : "0"}>
          {actions}
        </Flex>
        {menu ? (
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="1"
                highContrast
                aria-label={menuLabel}
              >
                <BsThreeDotsVertical size={14} />
              </IconButton>
            }
            menuPlacement="end"
            variant="soft"
          >
            {menu}
          </DropdownMenu>
        ) : null}
      </Flex>
    </Flex>
  );
}

/** What Save does with the card's staged change, and a way to take it back. */
export function StagedChangeNote({
  children,
  onUndo,
  mb = "3",
}: {
  children: ReactNode;
  onUndo: () => void;
  // "0" when nothing follows it in the card.
  mb?: "0" | "3";
}) {
  return (
    <Flex align="center" justify="between" gap="2" px="3" mb={mb}>
      <HelperText status="info" size="sm">
        {children}
      </HelperText>
      <Button variant="outline" size="sm" onClick={onUndo}>
        Undo
      </Button>
    </Flex>
  );
}

/** Separates the header's actions. */
export function CardHeaderDivider() {
  return (
    <Box
      style={{ width: 1, alignSelf: "stretch", background: "var(--gray-a5)" }}
    />
  );
}

/** A cell per variation, numbered like the cards above. */
export function VariationCells<V extends { id: string; index: number }>({
  variations,
  children,
}: {
  variations: V[];
  children: (variation: V) => ReactNode;
}) {
  return (
    <Grid columns={VARIATION_GRID_COLUMNS} gap="4" align="start">
      {variations.map((v) => (
        <Flex key={v.id} align="center" gap="2" px="3" minWidth="0">
          <Box flexShrink="0">
            <VariationNumber number={v.index} />
          </Box>
          <Box flexGrow="1" minWidth="0">
            {children(v)}
          </Box>
        </Flex>
      ))}
    </Grid>
  );
}

/**
 * "+ Add …" under a section. Says why when it can't be added now; a premium
 * kind can still be added to a draft, which then can't start.
 */
export function AddImplementationButton({
  label,
  onClick,
  disabledReason = null,
  commercialFeature = null,
}: {
  label: string;
  onClick: () => void;
  disabledReason?: string | null;
  commercialFeature?: CommercialFeature | null;
}) {
  const { hasCommercialFeature } = useUser();
  const button = (
    <Button
      variant="outline"
      icon={<PiPlus />}
      onClick={onClick}
      disabled={!!disabledReason}
    >
      {label}
    </Button>
  );
  if (disabledReason) {
    return <Tooltip content={disabledReason}>{button}</Tooltip>;
  }
  if (commercialFeature && !hasCommercialFeature(commercialFeature)) {
    return (
      <PremiumTooltip
        commercialFeature={commercialFeature}
        body="You can add this to your draft, but you will not be able to start the experiment until upgrading."
        usePortal
      >
        {button}
      </PremiumTooltip>
    );
  }
  return button;
}
