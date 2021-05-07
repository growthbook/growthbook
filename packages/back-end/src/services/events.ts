/*
import {TrackTableModel} from "../models/TrackTableModel";
import {DataSourceInterface} from "../models/DataSourceModel";
import {getLatestEvents} from "./datasource";
import unionBy from "lodash/unionBy";
import uniqid from "uniqid";

export async function getTrackTableByDataSource(datasource: string) {
  return TrackTableModel.findOne({
    datasource
  });
}

export async function getTrackTableByDataSources(datasources: string[]) {
  return TrackTableModel.find({
    datasource: {$in: datasources}
  });
}

export async function syncTrackTable(datasource: DataSourceInterface) {
  // Get existing model
  const trackTable = await getTrackTableByDataSource(datasource.id);
  if (trackTable) {
    // Get latest events from the data warehouse and build a hash lookup map
    const events = await getLatestEvents(datasource, trackTable.table, trackTable.dateUpdated);
    const newEventsMap = new Map();
    events.forEach(event => {
      newEventsMap.set(event.name, event);
    });

    // Update any existing events
    trackTable.events.forEach((event) => {
      if (newEventsMap.has(event.name)) {
        const newEvent = newEventsMap.get(event.name);
        event.properties = unionBy(newEvent.properties, event.properties, "name");
        event.lastSeen = newEvent.lastSeen;
      }
    });

    // Add any new records not already in trackTable
    const existingEvents = trackTable.events.map(event => event.name);
    events.forEach(event => {
      if (!existingEvents.includes(event.name)) {
        trackTable.events.push(event);
      }
    });

    trackTable.markModified("events");
    trackTable.set("dateUpdated", new Date());
    await trackTable.save();
    return trackTable;
  }
  else {
    const events = await getLatestEvents(datasource, "tracks", null);
    return await TrackTableModel.create({
      id: uniqid("tr_"),
      datasource: datasource.id,
      table: "tracks",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      events
    });
  }
}

*/
