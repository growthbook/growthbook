import React, { FC, useState } from "react";
import { ExposureQuery } from "shared/types/datasource";
import { DimensionSlicesInterface } from "shared/types/dimension";
import { Flex, Text } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
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

  const secondaryCTA = (
    <Button
      type="submit"
      onClick={async () => {
        await onSave(customDimensionMetadata, dimensionSlices);
        close();
      }}
    >
      Save Dimension Values
    </Button>
  );

  if (!exposureQuery) {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode",
    );
    return null;
  }

  return (
    <>
      <Modal
        trackingEventModalType=""
        open={true}
        close={close}
        secondaryCTA={secondaryCTA}
        size="max"
        header={"Configure Experiment Dimensions"}
      >
        <Flex direction="column" gap="2">
          <Text>
            Experiment Dimensions are additional columns made available in the
            Experiment Assignment Query. These columns can be used for
            dimension-based analysis without additional joins. Dimension values
            can be defined in this modal to ensure consistency, reliability, and
            query performance.
          </Text>
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
      </Modal>
    </>
  );
};
