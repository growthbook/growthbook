import React, { FC, useState } from "react";
import { ExposureQuery } from "shared/types/datasource";
import { DimensionSlicesInterface } from "shared/types/dimension";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import Text from "@/ui/Text";
import {
  CustomDimensionMetadata,
  DimensionSlicesRunner,
} from "@/components/Settings/EditDataSource/DimensionMetadata/DimensionSlicesRunner";

type UpdateDimensionMetadataModalProps = {
  exposureQuery: Pick<
    ExposureQuery,
    "id" | "dimensions" | "dimensionMetadata" | "dimensionSlicesId"
  >;
  datasourceId: string;
  close: () => void;
  onSave: (
    customDimensionMetadata: CustomDimensionMetadata[],
    dimensionSlices?: DimensionSlicesInterface,
  ) => Promise<void>;
};

export const UpdateDimensionMetadataModal: FC<
  UpdateDimensionMetadataModalProps
> = ({ exposureQuery, datasourceId, close, onSave }) => {
  const [dimensionSlicesId, setDimensionSlicesId] = useState<
    string | undefined
  >(exposureQuery.dimensionSlicesId);
  const { data, mutate: mutateDimensionSlices } = useApi<{
    dimensionSlices: DimensionSlicesInterface;
  }>(`/dimension-slices/${dimensionSlicesId}`, {
    shouldRun: () => !!dimensionSlicesId,
  });
  const dimensionSlices = data?.dimensionSlices;

  // track custom slices + priority locally
  const [customDimensionMetadata, setCustomDimensionMetadata] = useState<
    CustomDimensionMetadata[]
  >(
    exposureQuery.dimensions?.map((d, i) => {
      const existingMetadata = exposureQuery.dimensionMetadata?.find(
        (m) => m.dimension === d,
      );
      return {
        dimension: d,
        customSlicesArray: existingMetadata?.customSlices
          ? existingMetadata.specifiedSlices
          : undefined,
        priority: i + 1,
      };
    }) ?? [],
  );

  if (!exposureQuery) {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode",
    );
    return null;
  }

  return (
    <>
      <DialogLayout
        trackingEventModalType=""
        open={true}
        close={close}
        cta="Save Dimension Values"
        submit={async () => {
          await onSave(customDimensionMetadata, dimensionSlices);
          close();
        }}
        size="lg"
        header={"Configure Experiment Dimensions"}
      >
        <Flex direction="column" gap="4">
          <Box mb="2">
            <Text color="text-mid">
              Experiment Dimensions are additional columns made available in the
              Experiment Assignment Query. These columns can be used for
              dimension-based analysis without additional joins. Dimension
              values can be defined in this modal to ensure consistency,
              reliability, and query performance.
            </Text>
          </Box>
          <DimensionSlicesRunner
            exposureQueryId={exposureQuery.id}
            datasourceId={datasourceId}
            customDimensionMetadata={customDimensionMetadata}
            setCustomDimensionMetadata={setCustomDimensionMetadata}
            dimensionSlices={dimensionSlices}
            mutateDimensionSlices={mutateDimensionSlices}
            setDimensionSlicesId={setDimensionSlicesId}
          />
        </Flex>
      </DialogLayout>
    </>
  );
};
