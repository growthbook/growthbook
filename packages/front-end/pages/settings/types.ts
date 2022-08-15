import { OrganizationInterface } from "back-end/types/organization";

export interface SettingsApiResponse extends OrganizationInterface {
  slackTeam?: string;
}
