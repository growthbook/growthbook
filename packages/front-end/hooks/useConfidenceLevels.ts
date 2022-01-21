import useOrgSettings from "./useOrgSettings";

export default function useConfidenceLevels() {
  const settings = useOrgSettings();
  const ciUpper = settings.confidenceLevel || 0.95;
  return {
    ciUpper,
    ciLower: 1 - ciUpper,
    ciUpperDisplay: Math.round(ciUpper * 100) + "%",
    ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
  };
}
