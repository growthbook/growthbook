import React, { ReactNode, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretRightBold } from "react-icons/pi";
import Text from "@/ui/Text";
import { decimalToPercent } from "@/services/utils";

// Helpers passed to renderContent so the caller can compose the chevron
// inline with its own content (e.g. right next to a "3 visual changes"
// label) rather than at the row's far edge. Callers that don't care
// (feature flags, URL redirects) just ignore the second argument —
// JavaScript drops extra args silently.
export type LinkedChangeVariationRowHelpers = {
  // The chevron toggle JSX, ready to render. null when this row has no
  // `renderExpanded` content to reveal (control variants with nothing in
  // them, or callers that didn't pass renderExpanded at all). Place it
  // wherever it reads best.
  expandToggle: ReactNode | null;
  // True when the row is currently open. Useful if the caller wants to
  // change its content style based on open/closed state.
  isExpanded: boolean;
};

type VariationRowsProps = {
  experiment: ExperimentInterfaceStringDates;
  renderContent: (
    variationIndex: number,
    helpers: LinkedChangeVariationRowHelpers,
  ) => ReactNode;
  renderActions?: (variationIndex: number) => ReactNode;
  // When provided, the chevron toggle in `helpers.expandToggle` reveals
  // the result of this function in a full-width slot below the row.
  // Return null for variations that have no detail to show — the
  // chevron is suppressed in that case so an empty row doesn't tease
  // nothing. Backwards-compatible: callers that don't pass this render
  // exactly as before, and the second helpers arg's `expandToggle` is
  // null.
  renderExpanded?: (variationIndex: number) => ReactNode;
  alignContent?: "start" | "center";
};

export default function LinkedChangeVariationRows({
  experiment,
  renderContent,
  renderActions,
  renderExpanded,
  alignContent = "center",
}: VariationRowsProps) {
  const variations = getLatestPhaseVariations(experiment);
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  // Per-row expand state. A Set rather than a single index because users
  // may want to compare two variations open side-by-side. Keyed by index
  // — variation order is stable within a render of this component.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (j: number) => {
    setExpanded((curr) => {
      const next = new Set(curr);
      if (next.has(j)) next.delete(j);
      else next.add(j);
      return next;
    });
  };

  return (
    <>
      {variations.map((v, j) => {
        // Probe what renderExpanded would return BEFORE we decide whether
        // to surface the chevron. This means renderExpanded gets called
        // every render even for collapsed rows — that's intentional, so
        // a variation with no detail can suppress its chevron without
        // the caller having to plumb a separate "hasDetail" predicate.
        // The function should be cheap (it's rendering already-loaded
        // data, no fetches).
        const expandedNode = renderExpanded ? renderExpanded(j) : null;
        const hasExpandable =
          expandedNode !== null && expandedNode !== undefined;
        const isOpen = hasExpandable && expanded.has(j);
        // The chevron toggle, ready to render. We hand it to the caller
        // via the helpers arg so they can place it inline with their own
        // content (e.g. right next to a "3 visual changes" label). null
        // when nothing to expand → suppresses the affordance.
        const expandToggle: ReactNode | null = hasExpandable ? (
          <button
            type="button"
            onClick={() => toggle(j)}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Hide details" : "Show details"}
            title={isOpen ? "Hide details" : "Show details"}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              display: "inline-flex",
              alignItems: "center",
              color: "var(--gb-fg-subtle, var(--gb-fg))",
              opacity: 0.7,
            }}
          >
            <PiCaretRightBold
              style={{
                transition: "transform 120ms ease",
                transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            />
          </button>
        ) : null;

        return (
          <React.Fragment key={v.id}>
            <Flex
              align={alignContent}
              justify="between"
              width="100%"
              gap="9"
              minHeight="24px"
            >
              <Flex
                gap="1"
                flexBasis="15%"
                flexShrink="0"
                className={`variation with-variation-label variation${j}`}
              >
                <Box as="span" className="label">
                  {j}
                </Box>
                <Box as="span" className="text-ellipsis" title={v.name}>
                  <Text weight="semibold">{v.name}</Text>
                </Box>
              </Flex>
              <Flex flexBasis="90px" flexShrink="0" justify="end">
                <Text>
                  {decimalToPercent(latestPhase?.variationWeights?.[j] ?? 0)}%
                  Split
                </Text>
              </Flex>
              <Box flexGrow="1">
                {renderContent(j, { expandToggle, isExpanded: isOpen })}
              </Box>
              {renderActions && renderActions(j)}
            </Flex>
            {isOpen && (
              <Box mt="2" mb="2" pl="6">
                {expandedNode}
              </Box>
            )}
            {j < variations.length - 1 && <Separator size="4" mt="2" mb="3" />}
          </React.Fragment>
        );
      })}
    </>
  );
}
