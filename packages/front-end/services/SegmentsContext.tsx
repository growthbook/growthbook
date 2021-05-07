import { createContext, FC, useContext, useEffect } from "react";
import useApi from "../hooks/useApi";
import { useAuth } from "./auth";
import { SegmentInterface } from "back-end/types/segment";

export type SegmentsContextValue = {
  ready: boolean;
  error?: Error;
  refresh: () => void;
  getSegmentById: (id: string) => null | SegmentInterface;
  segments: SegmentInterface[];
};

const SegmentsContext = createContext<SegmentsContextValue>({
  ready: false,
  error: undefined,
  refresh: () => null,
  getSegmentById: () => null,
  segments: [],
});

export default SegmentsContext;

export const useSegments = (): SegmentsContextValue => {
  return useContext(SegmentsContext);
};

export const SegmentsProvider: FC = ({ children }) => {
  const { data, error, mutate } = useApi<{
    segments: SegmentInterface[];
  }>(`/segments`);

  const { orgId } = useAuth();
  useEffect(() => {
    if (orgId) {
      mutate();
    }
  }, [orgId]);

  const segmentMap = new Map<string, SegmentInterface>();
  if (data?.segments) {
    data.segments.forEach((segment) => {
      segmentMap.set(segment.id, segment);
    });
  }

  const getSegmentById = (id: string) => {
    return segmentMap.get(id);
  };

  return (
    <SegmentsContext.Provider
      value={{
        ready: data ? true : false,
        error: error,
        refresh: mutate,
        segments: data?.segments || [],
        getSegmentById,
      }}
    >
      {children}
    </SegmentsContext.Provider>
  );
};
