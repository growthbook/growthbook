import mongoose from "mongoose";
import { AvroSchemaConfigInterface } from "shared/validators";

const collection = mongoose.connection.collection("avroschemaconfigs");

/**
 * Cross-org query — returns all Avro schema configs.
 * Only used by the ingestion data-enrichment super-user endpoint.
 */
export async function _dangerousGetAvroSchemaConfigsForAllOrgs(): Promise<
  AvroSchemaConfigInterface[]
> {
  const docs = await collection.find({}).toArray();
  return docs as unknown as AvroSchemaConfigInterface[];
}
