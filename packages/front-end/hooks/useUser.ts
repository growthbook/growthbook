import { useContext } from "react";
import { UserContext } from "../components/ProtectedPage";

export default function useUser() {
  return useContext(UserContext);
}
