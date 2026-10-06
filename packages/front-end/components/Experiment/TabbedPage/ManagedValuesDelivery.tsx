import { ReactElement, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiDesktop, PiFlag, PiLink, PiTag } from "react-icons/pi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Avatar from "@/ui/Avatar";
import { DELIVERY_METHOD_LABELS, DeliveryMethod } from "./ManagedValuesContext";

// --- Method menu items ---------------------------------------------------

// Mirrors AddLinkedChangeButton.tsx's dropdown menu (Feature Flag / Visual
// Editor / URL Redirect, each with an icon + one-line description) without
// importing from it — that file's menu items aren't exported, and its own
// logic (commercial-feature gates, SDK-capability checks, split-button
// wiring) doesn't apply here. Icons/colors match ICON_PROPERTIES from
// components/Experiment/LinkedChanges/constants.ts; header/description copy
// is reused verbatim from AddLinkedChangeButton.tsx's MENU_ITEM_HEADERS /
// MENU_ITEM_DESCRIPTIONS.
export interface MethodMenuItem {
  method: DeliveryMethod;
  header: string;
  description: string;
  icon: ReactElement;
  // Used by the Linked Changes empty state and the Change Experiment Type
  // modal. The type select's menu doesn't (see MethodMenuItemContent).
  iconColor: "violet" | "indigo" | "amber" | "teal";
}

export const METHOD_MENU_ITEMS: MethodMenuItem[] = [
  {
    method: "feature-flag",
    header: DELIVERY_METHOD_LABELS["feature-flag"],
    description: "Make code changes in your app",
    icon: <PiFlag />,
    iconColor: "indigo",
  },
  {
    method: "visual-editor",
    header: DELIVERY_METHOD_LABELS["visual-editor"],
    description: "No-code browser extension",
    icon: <PiDesktop />,
    iconColor: "amber",
  },
  {
    method: "url-redirect",
    header: DELIVERY_METHOD_LABELS["url-redirect"],
    description: "A/B test URL redirects",
    icon: <PiLink />,
    iconColor: "teal",
  },
];

export const VALUES_MENU_ITEM: MethodMenuItem = {
  method: "values",
  header: DELIVERY_METHOD_LABELS.values,
  description: "Set a value per variation",
  icon: <PiTag />,
  iconColor: "violet",
};

// Values first (preselected), then Visual Editor, URL Redirect, Feature
// Flag — the order used by both the create-experiment modal's Experiment
// Type field and the Traffic Allocation header select below. Built from
// METHOD_MENU_ITEMS rather than duplicating copy, but reordered locally
// since METHOD_MENU_ITEMS' own order doesn't need to change for its other
// consumer (nothing currently reads it in this specific order elsewhere).
export const EXPERIMENT_TYPE_MENU_ITEMS: MethodMenuItem[] = [
  VALUES_MENU_ITEM,
  ...(["visual-editor", "url-redirect", "feature-flag"] as const).map(
    (method) => METHOD_MENU_ITEMS.find((item) => item.method === method)!,
  ),
];

// Shared row content for a method menu item — same icon/name/description
// layout everywhere it's used (this module's DeliveryTypeSelect, the
// create-experiment modal), so they can never visually drift apart.
export function MethodMenuItemContent({ item }: { item: MethodMenuItem }) {
  return (
    <Flex align="center" gap="2" p="3">
      {/* Every type's icon in the same soft violet as the Create
        Experiment modal's setup cards (set in review; each type had its own
        colour). */}
      <Avatar radius="small" color="violet" size="sm" variant="soft">
        {item.icon}
      </Avatar>
      <Flex direction="column">
        <Text color="text-high" weight="semibold">
          {item.header}
        </Text>
        <Text color="text-high">{item.description}</Text>
      </Flex>
    </Flex>
  );
}

// --- Delivery type select (draft state — interactive) ---------------------
//
// A field-styled trigger (bordered, full-width-of-container by default)
// around DropdownMenu/DropdownMenuItem/MethodMenuItemContent — reused as-is
// by both the create-experiment modal (SimpleNewExperimentForm.tsx) and the
// Traffic Allocation header (TrafficAllocationFunnel.tsx), per explicit
// request to reuse the same select + menu component in both places. Not
// @/ui/Select: that component can't split "just the name" in the closed
// trigger from "icon + name + description" in the open list (no exposed
// ItemText/Value sub-parts), which this needs.
export function DeliveryTypeSelect({
  value,
  setValue,
  label,
  width = "100%",
}: {
  value: DeliveryMethod;
  setValue: (v: DeliveryMethod) => void;
  // Rendered above the trigger when provided (the create modal's own field
  // label). Omitted in the Traffic Allocation header, where the select sits
  // inline next to the section title instead of as its own labeled field.
  label?: string;
  // Traffic Allocation header passes a sized-to-content width (e.g. "auto")
  // so the control doesn't stretch across the header; the create modal
  // keeps the default full-width-of-container behavior.
  width?: string;
}) {
  const selected = EXPERIMENT_TYPE_MENU_ITEMS.find((i) => i.method === value);
  // Tracked so the trigger can mock SelectField's own focused/active look
  // (a violet ring via box-shadow) while the menu is open — react-select's
  // real focus state isn't something a DropdownMenu-based trigger has
  // natively, since Radix's own [data-state="open"] styling lands on its
  // wrapping trigger element, not on this inner Button.
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  return (
    <Box
      style={{ width: width === "100%" ? "100%" : undefined }}
      // As a labeled field (the create modal), it's laid out like the legacy
      // Field / SelectField around it (set in review): in a Bootstrap
      // .form-group for the same spacing below it. Its label has the create
      // modal's label treatment, the Stats Engine label's (set in review):
      // 12px at weight 500, 4px above the control (Bootstrap's mb-1).
      // LEGACY: Bootstrap's form-group and spacing classes, which are what
      // the fields it sits among use.
      className={label ? "form-group" : undefined}
    >
      {label ? (
        <label className="mb-1">
          <Text size="sm" weight="medium">
            {label}
          </Text>
        </label>
      ) : null}
      <DropdownMenu
        variant="soft"
        menuPlacement="start"
        menuWidth={width === "100%" ? "full" : undefined}
        open={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        trigger={
          <Button
            variant="outline"
            color="gray"
            style={{
              width,
              height: 36,
              border: "1px solid var(--gray-a7)",
              borderRadius: "var(--radius-2)",
              // Mirrors SelectField/react-select's own focused-control
              // look exactly (see ReactSelectProps.styles.control in
              // SelectField.tsx): a violet ring, border color unchanged.
              boxShadow: isMenuOpen ? "0 0 0 1px var(--violet-8)" : "none",
              // Cancels the outline variant's own :hover background — an
              // inline style always wins over a class-based (non-!important)
              // rule, hover included, regardless of specificity.
              backgroundColor: "transparent",
              // Button wraps children in an inline <Text>, which shrinks to
              // content width — a percentage-width Flex inside it can't
              // actually stretch to fill the button (there's no definite
              // containing-block width to resolve against), which is why
              // the whole icon+label+chevron group was rendering centered
              // as one block instead of split left/right. Taking the
              // chevron out of that flow with position:absolute (anchored
              // to this Button, since it's the nearest positioned
              // ancestor) sidesteps that entirely.
              position: "relative",
              justifyContent: "flex-start",
            }}
          >
            <Flex align="center" gap="2" style={{ paddingRight: 24 }}>
              <span
                style={{
                  color: "var(--text-color-main)",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {selected?.icon}
              </span>
              <span
                style={{
                  color: "var(--text-color-main)",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {selected?.header ?? "Select..."}
              </span>
            </Flex>
            <PiCaretDown
              size={16}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--gray-12)",
              }}
            />
          </Button>
        }
      >
        {EXPERIMENT_TYPE_MENU_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.method}
            style={{
              padding: 0,
              height: "auto",
              // Matches SelectField/react-select's own selected-option
              // styling exactly (.gb-select__option--is-selected in
              // react-select.scss) — a value is always selected here, so
              // this is the only way to show which one.
              ...(item.method === value
                ? { backgroundColor: "var(--gray-a3)", borderRadius: 4 }
                : {}),
            }}
            onClick={() => setValue(item.method)}
          >
            <MethodMenuItemContent item={item} />
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </Box>
  );
}
