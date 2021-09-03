import Agenda, { Job } from "agenda";
import { AWS_CLOUDFRONT_DISTRIBUTION_ID } from "../util/secrets";
import AWS from "aws-sdk";
import { CreateInvalidationRequest } from "aws-sdk/clients/cloudfront";

const INVALIDATE_JOB_NAME = "fireInvalidate";
type InvalidateJob = Job<{
  urls: string[];
  retryCount: number;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(INVALIDATE_JOB_NAME, async (job: InvalidateJob) => {
    const { urls } = job.attrs.data;

    if (!urls) return;

    const cloudfront = new AWS.CloudFront();
    const params: CreateInvalidationRequest = {
      DistributionId: AWS_CLOUDFRONT_DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: "" + Date.now(),
        Paths: {
          Quantity: urls.length,
          Items: urls,
        },
      },
    };
    cloudfront.createInvalidation(params, function (err, data) {
      if (err) {
        console.log("Cache invalidate: Error invalidating CDN");
        console.log(err, err.stack);
        throw new Error("Cache invalidate: Error: " + err);
      } else {
        // successful response
        console.log("Cache invalidate: suceeded");
        console.log(data);
      }
    });
  });
  agenda.on(
    "fail:" + INVALIDATE_JOB_NAME,
    async (error: Error, job: InvalidateJob) => {
      const retryCount = job.attrs.data.retryCount;
      let nextRunAt = Date.now();
      // Wait 30s after the first failure
      if (retryCount === 0) {
        nextRunAt += 30000;
      }
      // Wait 5m after the second failure
      else if (retryCount === 1) {
        nextRunAt += 300000;
      }
      // If it failed 3 times, give up
      else {
        // TODO: email the organization owner
        return;
      }

      job.attrs.data.retryCount++;
      job.attrs.nextRunAt = new Date(nextRunAt);
      await job.save();
    }
  );
}

export async function queueCDNInvalidate(urls: string[]) {
  const job = agenda.create(INVALIDATE_JOB_NAME, {
    urls,
    retryCount: 0,
  }) as InvalidateJob;
  //job.unique({ webhookId });
  job.schedule(new Date());
  await job.save();
}
