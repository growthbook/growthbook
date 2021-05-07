import { useContext } from "react";
import DatasourceContext, {
  DatasourceContextValue,
} from "../services/DatasourceContext";

export default function useDatasources(): DatasourceContextValue {
  return useContext(DatasourceContext);
}
