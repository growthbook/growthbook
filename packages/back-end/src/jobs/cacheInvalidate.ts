import Agenda, { Job } from "agenda";
import { AWS_CLOUDFRONT_DISTRIBUTION_ID, IS_CLOUD } from "../util/secrets";
import AWS from "aws-sdk"; // v2 way
//import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront"; // v3 way.
import { CreateInvalidationRequest } from "aws-sdk/clients/cloudfront";
import { ExperimentInterface } from "../../types/experiment";
import { getAllApiKeysByOrganization } from "../services/apiKey";

const INVALIDATE_JOB_NAME = "fireInvalidate";
type InvalidateJob = Job<{
  url: string;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(INVALIDATE_JOB_NAME, async (job: InvalidateJob) => {
    const { url } = job.attrs.data;

    if (!url) return;
    // we should eventually restructure this to a cron job that collects
    // a full list of all URLs to be cleared, and send one clear request
    // to AWS, which might help reduce the number of calls to aws.
    if (AWS_CLOUDFRONT_DISTRIBUTION_ID) {
      const cloudfront = new AWS.CloudFront();
      const params: CreateInvalidationRequest = {
        DistributionId: AWS_CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: "" + Date.now(),
          Paths: {
            Quantity: 1,
            Items: [url],
          },
        },
      };

      cloudfront.createInvalidation(params, function (err) {
        if (err) {
          console.log("Cache invalidate: Error invalidating CDN");
          console.log(err, err.stack);
          throw new Error("Cache invalidate: Error: " + err);
        } else {
          // successful response
          //console.log("Cache invalidate: succeeded");
          //console.log(data);
        }
      });
    }
    // add other invalidations here.
  });
}

export async function queueCDNInvalidate(
  orgId: string,
  experiment: ExperimentInterface
) {
  if (IS_CLOUD && AWS_CLOUDFRONT_DISTRIBUTION_ID) {
    const apiKeys = await getAllApiKeysByOrganization(orgId);

    // if they have API key:
    if (apiKeys && apiKeys.length) {
      // Queue up a job(s) to invalidate paths in the CDN
      for (const k of apiKeys) {
        let url: string;
        if (experiment.implementation === "visual") {
          url = "/js/" + k.key + ".js";
        } else {
          url = "/config/" + k.key;
        }
        const job = agenda.create(INVALIDATE_JOB_NAME, {
          url,
        }) as InvalidateJob;
        job.unique({ url });
        job.schedule(new Date());
        await job.save();
      }
    }
  }
}
