import { ApiContextualBanditInterface } from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";

/**
 * CB-native variation cards mirroring the experiment `VariationBox` look
 * (colored top bar, circle-label index, name, key, initial split) without any
 * screenshot/upload affordances — the CB API omits screenshots.
 */
export default function ContextualBanditVariations({
  cb,
  canEdit,
  editVariations,
}: {
  cb: ApiContextualBanditInterface;
  canEdit?: boolean;
  editVariations?: () => void;
}) {
  const numVariations = cb.variations.length;

  const weightForIndex = (i: number): number => {
    const fallback = numVariations > 0 ? 1 / numVariations : 0;
    const variationId = cb.variations[i]?.id;
    const match = cb.variationWeights?.find(
      (w) => w.variationId === variationId,
    );
    return match?.weight ?? fallback;
  };
  const formatWeight = (w: number): string =>
    new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(w);

  const cols = numVariations > 4 ? 4 : Math.max(numVariations, 1);
  const hasDescriptions = cb.variations.some((v) => !!v.description?.trim());

  return (
    <Box>
      <Flex justify="between" align="center" mb="3" mx="1" gap="3">
        <Heading color="text-high" as="h4" size="small" mb="0">
          Variations
        </Heading>
        {canEdit && editVariations ? (
          <Button variant="ghost" onClick={editVariations}>
            Edit Variations
          </Button>
        ) : null}
      </Flex>
      <Grid
        gap="4"
        columns={{
          initial: "1",
          xs: "2",
          sm: cols === 2 ? "2" : "3",
          md: cols.toString(),
        }}
      >
        {cb.variations.map((v, i) => (
          <Box
            key={v.id}
            p="5"
            pb="3"
            className={`appbox mb-0 position-relative variation variation${i} with-variation-label`}
          >
            <Box
              className={`variation variation${i} with-variation-color`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                height: "6px",
              }}
            />
            <Flex gap="2" direction="column" justify="between" height="100%">
              <Box>
                <Box mb="3">
                  <Flex gap="0" align="center">
                    <Box>
                      <span className="circle-label label">{i}</span>
                    </Box>
                    <Heading as="h4" size="small" mb="0">
                      {v.name}
                    </Heading>
                  </Flex>
                </Box>
                {hasDescriptions ? (
                  <Box mb="2">
                    <Text color="text-mid" size="small">
                      {v.description || "--"}
                    </Text>
                  </Box>
                ) : null}
              </Box>
              <Box>
                <code className="small">ID: {v.key}</code>
                <Flex align="center" justify="between" mt="1">
                  <Box>Split: {formatWeight(weightForIndex(i))}</Box>
                </Flex>
              </Box>
            </Flex>
          </Box>
        ))}
      </Grid>
    </Box>
  );
}
