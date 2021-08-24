import { Member } from "./organization";

export interface ProjectInterface {
  id: string;
  organization: string;
  name: string;
  members: Member[];
  dateCreated: Date;
  dateUpdated: Date;
}
