import mongoose from "mongoose";

export interface Property {
  name: string;
  type: string;
  lastSeen: Date;
}

export interface EventInterface {
  name: string;
  lastSeen: Date;
  properties: Property[];
}

export interface TrackTableInterface {
  id: string;
  datasource: string;
  table: string;
  dateCreated: Date;
  dateUpdated: Date;
  events: EventInterface[];
}

export type TrackTableDocument = mongoose.Document & TrackTableInterface;

const trackTableSchema = new mongoose.Schema({
  id: String,
  datasource: String,
  table: String,
  dateCreated: Date,
  dateUpdated: Date,
  events: [
    {
      _id: false,
      name: String,
      lastSeend: Date,
      properties: [
        {
          _id: false,
          name: String,
          type: { type: String },
          lastSeen: Date,
        },
      ],
    },
  ],
});

export const TrackTableModel = mongoose.model<TrackTableDocument>(
  "TrackTable",
  trackTableSchema
);
