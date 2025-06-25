import React, { FC, useEffect, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExperimentDimensionMetadata,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { DimensionSlicesInterface } from "back-end/types/dimension";
import { Flex, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Modal from "@/components/Modal";
import track from "@/services/track";
import { DimensionSlicesRunner } from "@/components/Settings/EditDataSource/DimensionMetadata/DimensionSlicesRunner";

export function getLatestDimensionSlices(
  dataSourceId: string,
  exposureQueryId: string,
  metadataId: string | undefined,
  apiCall: <T>(
    url: string | null,
    options?: RequestInit | undefined
  ) => Promise<T>,
  setId: (id: string) => void,
  mutate: () => void
): void {
  if (!dataSourceId || !exposureQueryId) return;
  if (metadataId) {
    setId(metadataId);
    mutate();
    return;
  } else {
    apiCall<{ dimensionSlices: DimensionSlicesInterface }>(
      `/dimension-slices/datasource/${dataSourceId}/${exposureQueryId}`
    )
      .then((res) => {
        if (res?.dimensionSlices?.id) {
          setId(res.dimensionSlices.id);
          mutate();
        }
      })
      .catch((e) => {
        console.error(e);
      });
  }
}

type UpdateDimensionMetadataModalProps = {
  dimensionMetadata?: ExperimentDimensionMetadata[];
  dimensionSlices?: DimensionSlicesInterface;
  close: () => void;
  onRefresh: (exposureQueryId: string, lookbackDays: number) => void;
  onSave: (dimensionMetadata: ExperimentDimensionMetadata[]) => void;
};

export const UpdateDimensionMetadataModal: FC<UpdateDimensionMetadataModalProps> = ({
  dimensionMetadata,
  dimensionSlices,
  close,
  onRefresh,
  onSave,
}) => {
  const saveEnabled = dimensionMetadata && dimensionSlices; // TODO

  const secondaryCTA = (
    <button
      className={`btn btn-primary`}
      type="submit"
      disabled={!saveEnabled}
      onClick={async () => {
          // TODO only save if dimensionMetadata is defined?
          await onSave(newDimensionMetadata);
          close();
        }
      }
    >
      Save Dimension Values
    </button>
  );

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
            dimensionSlices={dimensionSlices}
            status={status}
            setId={setId}
            mutate={mutate}
            dataSource={dataSource}
            exposureQuery={exposureQuery}
            source={source}
            onSave={setLocalExposureQuery}
          />
        </Flex>
      </Modal>
    </>
  );
};