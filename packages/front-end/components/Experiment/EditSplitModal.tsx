import { useState } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { getEqualWeights } from "shared/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { PercentField } from "@/components/Forms/PercentSliderField";
import { decimalToPercent, floatRound, rebalance } from "@/services/utils";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import HelperText from "@/ui/HelperText";

export interface Props {
  variations: { id: string; name?: string; key?: string }[];
  weights: number[];
  close: () => void;
  /** Takes the weights as decimals, in variation order. */
  onConfirm: (weights: number[]) => void;
  /** `Confirm` where the page writes later, `Save` where this modal does. */
  staged?: boolean;
}

/** Whole percentages only, so a split can't carry more precision than it shows. */
const total = (weights: number[]) =>
  floatRound(
    weights.reduce((sum, w) => sum + w, 0),
    4,
  );

/** Moves traffic between variations, and nothing else. */
export default function EditSplitModal({
  variations,
  weights: savedWeights,
  close,
  onConfirm,
  staged,
}: Props) {
  const [weights, setWeights] = useState(savedWeights);
  const sum = total(weights);
  const addsUp = Math.abs(sum - 1) < 0.0001;

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-split"
      open={true}
      close={close}
      header="Edit Split"
      subheader="How the included traffic divides between variations."
      cta={staged ? "Confirm" : "Save"}
      ctaEnabled={addsUp}
      submit={async () => onConfirm(weights)}
      size="md"
    >
      <Flex direction="column" gap="3" pt="2">
        {variations.map((v, i) => (
          <Flex key={v.id} align="center" justify="between" gap="4">
            <VariationLabel number={i} name={v.name ?? `Variation ${i}`} />
            <PercentField
              value={weights[i] ?? 0}
              // The rest of the split absorbs the change, as it does everywhere
              // else a weight is edited.
              onChange={(weight) => setWeights(rebalance(weights, i, weight))}
              ariaLabel={`${v.name || v.key || `Variation ${i}`} split`}
            />
          </Flex>
        ))}
        <Separator size="4" />
        <Flex align="center" justify="between" gap="4">
          <Link onClick={() => setWeights(getEqualWeights(variations.length))}>
            Set equal
          </Link>
          {addsUp ? (
            <Text color="text-mid">{decimalToPercent(sum)}%</Text>
          ) : (
            <HelperText status="error" size="sm">
              {decimalToPercent(sum)}% — must total 100%
            </HelperText>
          )}
        </Flex>
      </Flex>
    </ModalStandard>
  );
}
