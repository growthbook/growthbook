import { OrganizationInterface } from "../../../../../types/organization";
import { GroupMap } from "../../../../../types/saved-group";

export type BasePayloadCreatorOptions = {
  organization: OrganizationInterface;
  savedGroupMap: GroupMap;
};
