import { useState } from "react";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import Callout from "@/ui/Callout";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import {
  DeliveryMethod,
  ManagedValuesConfig,
  useExperimentType,
  useManagedValues,
} from "./ManagedValuesContext";
import {
  EXPERIMENT_TYPE_MENU_ITEMS,
  MethodMenuItem,
} from "./ManagedValuesDelivery";
import {
  getLinkedChangesSummary,
  getLowercasePluralLabel,
  joinWithAnd,
  LinkedChangesSummary,
  ReferenceDeliveryMethod,
} from "./linkedChangesSummary";

const EMPTY_LINKED_CHANGES_SUMMARY = getLinkedChangesSummary({
  linkedFeatures: [],
  visualChangesets: [],
  urlRedirects: [],
});

// Only the first character — "URL redirects" is already capitalized as an
// acronym, so this only ever has visible work to do when the sentence
// starts with "feature flags" or "visual editor changes".
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A standing statement, not a per-transition warning: computed only from
// the experiment's CURRENT type and its linked records — no `selected`
// parameter at all — so it's fixed for the whole time the modal is open. It
// must not appear, disappear, or reword itself as the user clicks between
// radio cards; only reopening the modal against a different underlying
// state changes it. Two earlier versions both keyed off `selected` (one
// warned only on transitions TO Values; before that, one compared
// currentType against selectedType directly) — both made the banner
// flicker in and out while clicking between cards, which is exactly what
// this must not do.
//
// Two things can prompt it, mutually exclusive by construction (Values
// never has "linked change records" in `summary`; the three reference
// types never own a per-variation payload):
//
// 1. Values' per-variation payload is owned by the experiment — leaving
//    Values genuinely deletes it (setManagedValues(null) in submit below).
// 2. Any of the three reference types' records still exist somewhere, but
//    the record list (LinkedChanges.tsx) only ever renders the CURRENT
//    type's records — so if the experiment has any linked change records
//    at all, naming every type that has them tells the user up front that
//    changing type will stop showing them here, without waiting for a
//    specific selection to make that concrete.
function getConfiguredWarning(
  currentType: DeliveryMethod,
  managedValues: ManagedValuesConfig | null,
  summary: LinkedChangesSummary,
): string | null {
  if (currentType === "values") {
    const hasValues = Object.values(
      managedValues?.valuesByVariationId ?? {},
    ).some((v) => !!v);
    return hasValues
      ? "The values set on your variations will be removed."
      : null;
  }

  const linkedTypeLabels = (
    Object.keys(summary.counts) as ReferenceDeliveryMethod[]
  )
    .filter((t) => summary.counts[t] > 0)
    .map(getLowercasePluralLabel);

  return linkedTypeLabels.length > 0
    ? `${capitalizeFirst(joinWithAnd(linkedTypeLabels))} will stop working if you change the experiment type.`
    : null;
}

// Same anchor LinkedChanges.tsx's Frame uses for every non-Values type (see
// its own id comment) — one id, shared by all three reference types.
const LINKED_CHANGES_SECTION_ID = "linked-feature-flags";

function scrollLinkedChangesIntoView() {
  const el = document.getElementById(LINKED_CHANGES_SECTION_ID);
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const alreadyFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
  if (alreadyFullyVisible) return;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  el.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
}

export default function ChangeExperimentTypeModal({
  close,
  linkedChangesSummary = EMPTY_LINKED_CHANGES_SUMMARY,
  current,
  onApply,
}: {
  close: () => void;
  linkedChangesSummary?: LinkedChangesSummary;
  // With onApply (set in review, for the Setup page's draft): the modal
  // starts from `current` (the draft's type), and Apply hands the choice to
  // the caller, whose save bar makes the change (clearing what the old type
  // owned, as below). Without it, the change is made straight away.
  current?: DeliveryMethod;
  onApply?: (type: DeliveryMethod) => void;
}) {
  const { type, setType, setVisualEditorUrl } = useExperimentType();
  const { config: managedValues, setConfig: setManagedValues } =
    useManagedValues();
  const startType = current ?? type;
  const [selected, setSelected] = useState<DeliveryMethod>(startType);

  // No `selected` dependency — see getConfiguredWarning's own comment for
  // why. Computed once per modal open, not per click.
  const warning = getConfiguredWarning(
    type,
    managedValues,
    linkedChangesSummary,
  );

  return (
    <ModalStandard
      open={true}
      close={close}
      size="640"
      header="Change Experiment Type"
      subheader={
        // One-off: Modal's own Description renders at size="3" (16px) with
        // no per-instance override — nesting our own Text here at
        // size="medium" (Radix size "2" / var(--font-size-2), 14px) resets
        // the font-size for just this modal's description without touching
        // the shared Modal component.
        <Text size="md">
          Choose how this experiment delivers its variations.
          <br />
          <Text as="span" fontStyle="italic">
            Note: The type can&apos;t be changed after the experiment starts.
          </Text>
        </Text>
      }
      trackingEventModalType="change-experiment-type-modal"
      cta={onApply ? "Apply" : "Change Type"}
      ctaEnabled={selected !== startType}
      submit={async () => {
        if (onApply) {
          onApply(selected);
          return;
        }
        if (type === "values" || type === "url-redirect") {
          setManagedValues(null);
        } else if (type === "visual-editor") {
          setVisualEditorUrl("");
        }
        setType(selected);
        // Values has no Linked Changes section to scroll to. Deferred to
        // the next paint (rather than called synchronously here) so that
        // switching FROM "values" gives SetupPage.tsx's type gate a
        // chance to actually mount the section first — setType's re-render
        // hasn't happened yet at this point in the function.
        if (selected !== "values") {
          requestAnimationFrame(scrollLinkedChangesIntoView);
        }
      }}
    >
      {warning ? (
        // Modal.Body's own mt="5" (24px) is the gap from the description
        // above; mt="0px" leaves it at that (an earlier -8px cut the
        // callout's top off against the header, so pulled back to 0 here).
        // mb="28px" is that same 24px +12px below, down to the radio cards.
        // Callout's mt/mb accept arbitrary CSS strings (not just the
        // space-scale tokens), so both are exact without touching the
        // shared Modal component.
        <Callout status="warning" mt="0px" mb="28px">
          {warning}
        </Callout>
      ) : null}
      <RadioCards
        columns="1"
        width="100%"
        // +4px below the description when there's no warning above; when
        // there is, the warning's own mb="4" already provides the gap.
        mt={warning ? undefined : "1"}
        value={selected}
        setValue={(v) => setSelected(v as DeliveryMethod)}
        options={EXPERIMENT_TYPE_MENU_ITEMS.map((item: MethodMenuItem) => ({
          value: item.method,
          label: item.header,
          description: item.description,
          avatar: (
            <Avatar
              radius="small"
              color={item.iconColor}
              size="sm"
              variant="soft"
            >
              {item.icon}
            </Avatar>
          ),
          // Independent of `selected` — renders on the experiment's actual
          // current type regardless of which card is selected, including
          // when that's also the selected one. Gray/soft (Badge's default
          // variant) so it reads as informational, not as another control.
          // Plain "Current" badge. The source branch also set gray/xs via
          // badgeColor and badgeSize, which RadioCards on this branch doesn't
          // support.
          badge: item.method === type ? "Current" : undefined,
        }))}
      />
    </ModalStandard>
  );
}
