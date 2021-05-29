import { useContext } from "react";
import { UserContext } from "../components/ProtectedPage";

export default function useConfidenceLevels() {
  const { settings } = useContext(UserContext);
  const ciUpper = settings.confidenceLevel || 0.95;
  return {
    ciUpper,
    ciLower: 1 - ciUpper,
    ciUpperDisplay: Math.round(ciUpper * 100) + "%",
    ciLowerDisplay: Math.round((1 - ciUpper) * 100) + "%",
  };
}
