export interface DestinationURL {
  url: string;
  variation: string;
}

export interface URLRedirectInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  organization: string;
  experiment: string;
  urlPattern: string;
  destinationURLs: DestinationURL[];
  persistQueryString: boolean;
}
