/// <reference types="../../typings/jstat" />
import { GrowthBook } from "@growthbook/growthbook";
import { jStat } from "jstat";
import fs from "fs";

const NUM_USERS = 10000;
const OUTPUT_DIR = "/tmp/csv";

type TableData = {
  userId: string;
  anonymousId: string;
  sessionId: string;
  browser: string;
  country: string;
  timestamp: string;
};
type PageViewTableData = TableData & {
  path: string;
};
type SessionTableData = TableData & {
  duration: number;
  pages: number;
  sessionStart: string;
};
type ExperimentTableData = TableData & {
  experimentId: string;
  variationId: number;
};
type PurchaseTableData = TableData & {
  amount: number;
  qty: number;
};
type EventTableData = TableData & {
  value?: number;
  event: string;
};

const userRetention: Record<string, number> = {};

const startDate = new Date();
startDate.setDate(startDate.getDate() - 90);
function getDateRangeCondition(start: number, end: number) {
  const s = new Date(startDate);
  const e = new Date(startDate);
  s.setDate(s.getDate() + start);
  e.setDate(e.getDate() + end);

  return {
    date: {
      $gte: s.toISOString().substring(0, 10),
      $lte: e.toISOString().substring(0, 10),
    },
  };
}

const currentDate = new Date(startDate);

function setRandomTime() {
  currentDate.setHours(Math.floor(Math.random() * 12));
  currentDate.setMinutes(Math.floor(Math.random() * 50));
  currentDate.setSeconds(0);
}

function advanceTime(max = 61) {
  const seconds = normalInt(1, max);
  currentDate.setSeconds(currentDate.getSeconds() + seconds);
}

const experimentViews: ExperimentTableData[] = [];
function trackExperiment(
  data: Omit<ExperimentTableData, "experimentId" | "variationId">,
  result: { inExperiment: boolean; variationId: number },
  experimentId: string
) {
  if (!result.inExperiment) return;
  experimentViews.push({
    ...data,
    experimentId,
    variationId: result.variationId,
    timestamp: getTimestamp(),
  });
}

const events: EventTableData[] = [];
function trackEvent(data: Omit<EventTableData, "event">, event: string) {
  events.push({
    value: 0,
    ...data,
    event,
    timestamp: getTimestamp(),
  });
}

const purchases: PurchaseTableData[] = [];
function trackPurchase(data: PurchaseTableData) {
  purchases.push({
    ...data,
    timestamp: getTimestamp(),
  });
}

const pageViews: PageViewTableData[] = [];
function trackPageView(data: PageViewTableData) {
  pageViews.push({
    ...data,
    timestamp: getTimestamp(),
  });
}

function getBrowser(): string {
  const r = Math.random();
  if (r < 0.68) {
    return "Chrome";
  }
  if (r < 0.87) {
    return "Safari";
  }
  if (r < 0.91) {
    return "Edge";
  }
  if (r < 0.95) {
    return "Firefox";
  }
  if (r < 0.98) {
    return "Samsung Internet";
  }
  return "Opera";
}

function normalInt(min: number, max: number): number {
  const mean = (max - min) / 2 + min;
  const stddev = (max - min) / 3;

  const x = Math.round(jStat.normal.sample(mean, stddev));
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function getCountry(userId: number): string {
  const i = userId % 10;
  if (i < 6) return "US";
  if (i < 8) return "UK";
  if (i < 9) return "CA";
  return "AU";
}

function viewHomepage(data: TableData, gb: GrowthBook) {
  // Land on home page
  trackPageView({
    ...data,
    path: "/",
  });
  // Homepage CTA experiment (no change to behavior)
  trackExperiment(
    data,
    gb.run({
      key: "homepage-nav-ios",
      variations: [0, 1, 2],
      weights: [0.5, 0.25, 0.25],
      condition: {
        browser: "Safari",
      },
    }),
    "homepage-nav-ios"
  );

  advanceTime(30);

  // Only some users open the navigation
  if (Math.random() < 0.5) {
    trackEvent(data, "Open Nav");
  }

  // And some perform a search
  const searched = Math.random() < 0.8;
  if (searched) {
    trackEvent(data, "Search");
  }

  advanceTime(30);

  return !searched;
}

function viewSearchResults(data: TableData, gb: GrowthBook) {
  trackPageView({
    ...data,
    path: "/search",
  });
  // A/B test on the search order (mixed, less people sorting manually, but more bounces)
  const res = gb.run({
    key: "results-order",
    // Bounce rate
    variations: [0.15, 0.12],
    condition: getDateRangeCondition(5, 35),
  });
  trackExperiment(data, res, "results-order");
  advanceTime(20);

  // Some people sort manually (depends on experiment variation)
  if (Math.random() < Math.pow(res.value, 2) * 5) {
    trackEvent(data, "Sort Results");
  }

  // Bounce rate also depends on variation
  return Math.random() < 0.3 - res.value;
}

function viewItemPage(data: TableData, gb: GrowthBook) {
  // Id corresponds to price
  const itemId = Math.floor(Math.random() * 10 + 1);
  trackPageView({
    ...data,
    path: `/item/${itemId}`,
  });
  // A/B test price display (loser, fewer qty purchased)
  let res = gb.run({
    key: "price-display",
    // Max qty purchased
    variations: [7, 5],
    condition: getDateRangeCondition(30, 60),
  });
  trackExperiment(data, res, "price-display");
  const qty = normalInt(1, res.value);
  const amount = qty * itemId;

  // A/B test the add-to-cart CTA (winner)
  res = gb.run({
    key: "add-to-cart-cta",
    variations: [0.3, 0.36],
    condition: getDateRangeCondition(45, 75),
  });

  advanceTime(20);
  if (Math.random() < res.value) {
    trackEvent(
      {
        ...data,
        value: amount,
      },
      "Add to Cart"
    );
    return {
      itemId,
      addToCart: true,
      qty,
      amount,
    };
  }

  return {
    itemId,
    addToCart: false,
    qty: 0,
    amount: 0,
  };
}

function viewCheckout(data: TableData, gb: GrowthBook) {
  trackPageView({
    ...data,
    path: `/checkout`,
  });
  // A/B test checkout layout (variation 1 is worse, 2 is better)
  const res = gb.run({
    key: "checkout-layout",
    // Bounce rate
    variations: [0.3, 0.4, 0.25],
    condition: getDateRangeCondition(50, 100),
  });
  trackExperiment(data, res, "checkout-layout");
  advanceTime(30);
  return Math.random() < res.value;
}

function purchase(data: TableData, gb: GrowthBook, qty: number, price: number) {
  trackPageView({
    ...data,
    path: `/success`,
  });
  trackPurchase({
    ...data,
    qty: qty,
    amount: price,
  });
  advanceTime(30);

  // A/B test confirmation email (winner, improved retention)
  const res = gb.run({
    key: "confirmation-email",
    // How much retention is gained (out of 100)
    variations: [5, 10],
    condition: getDateRangeCondition(70, 90),
  });
  trackExperiment(data, res, "confirmation-email");
  userRetention[parseInt(data.userId)] += normalInt(
    res.value - 10,
    res.value + 10
  );
}

function getTimestamp() {
  return currentDate.toISOString().substring(0, 19).replace("T", " ");
}

const sessions: SessionTableData[] = [];
async function simulateSession(
  userId: number,
  anonymousId: string
): Promise<Omit<SessionTableData, "duration" | "pages">> {
  setRandomTime();
  const browser = getBrowser();
  const commonEventData: TableData = {
    userId: userId + "",
    anonymousId: browser + anonymousId,
    sessionId: Math.random() + "",
    browser,
    country: getCountry(userId),
    timestamp: "",
  };
  const sessionData = {
    ...commonEventData,
    sessionStart: getTimestamp(),
  };

  const gb = new GrowthBook({
    attributes: {
      id: userId,
      anonId: commonEventData.anonymousId,
      date: currentDate.toISOString().substring(0, 10),
      browser: commonEventData.browser,
      country: commonEventData.country,
    },
  });

  let bounce = viewHomepage(commonEventData, gb);
  if (bounce) return sessionData;

  bounce = viewSearchResults(commonEventData, gb);
  if (bounce) return sessionData;

  // Views a couple items
  let qty = 0;
  let price = 0;
  // A/B test that shows recommended items (increases number viewed)
  const res = gb.run({
    key: "recommended-items",
    variations: [4, 4.2, 4.4],
    condition: getDateRangeCondition(20, 50),
  });
  const itemsViewed = normalInt(1, res.value);
  for (let i = 0; i < itemsViewed; i++) {
    const item = viewItemPage(commonEventData, gb);
    qty += item.qty;
    price += item.amount;
  }
  if (!qty) return sessionData;

  bounce = viewCheckout(commonEventData, gb);
  if (bounce) return sessionData;

  purchase(commonEventData, gb, qty, price);

  return sessionData;
}

const anonymousIds: Record<string, string> = {};
async function simulate() {
  for (let i = 0; i < 90; i++) {
    for (let j = 0; j < NUM_USERS; j++) {
      // Space out people's starting days
      const firstDay = (j / NUM_USERS) * 60;
      if (i < firstDay) continue;

      // If user is retained
      const r = Math.random() * 800;
      if (!(j in userRetention)) {
        userRetention[j] = 100;
      }
      if (r >= userRetention[j]) continue;

      // Small chance of clearing cookies
      if (!anonymousIds[j] || Math.random() < 0.05) {
        anonymousIds[j] = j + "__" + Math.random() + "";
      }

      const startingPageviews = pageViews.length;
      const data = await simulateSession(j, anonymousIds[j]);
      const duration = Math.round(
        (currentDate.getTime() - new Date(data.sessionStart + "Z").getTime()) /
          1000
      );
      sessions.push({
        ...data,
        pages: pageViews.length - startingPageviews,
        duration,
      });

      userRetention[j] -= normalInt(20, 40);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function writeCSV(objs: Record<string, unknown>[], filename: string) {
  const path = OUTPUT_DIR + "/" + filename;
  const firstRow = objs.shift();
  if (!firstRow) return;
  const rows: string[][] = [];
  const headers = Object.keys(firstRow);
  rows.push(headers);
  for (let i = 0; i < objs.length; i++) {
    const row: string[] = [];
    for (let j = 0; j < headers.length; j++) {
      row.push(String(objs[i][j] || ""));
    }
  }
  const contents = rows.map((row) => row.join(",")).join("\n") + "\n";
  fs.writeFileSync(path, contents);
}

console.log("Generating dummy data...");
simulate().then(async () => {
  const sortDate = (a: TableData, b: TableData) =>
    a.timestamp.localeCompare(b.timestamp);

  sessions.sort((a, b) => a.sessionStart.localeCompare(b.sessionStart));
  pageViews.sort(sortDate);
  experimentViews.sort(sortDate);
  purchases.sort(sortDate);
  events.sort(sortDate);

  console.log({
    users: NUM_USERS,
    sessions: sessions.length,
    pageViews: pageViews.length,
    experiments: experimentViews.length,
    purchases: purchases.length,
    events: events.length,
  });

  console.log(`Writing CSVs to '${OUTPUT_DIR}'...`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeCSV(sessions, "sessions.csv");
  writeCSV(sessions, "sessions.csv");
  writeCSV(pageViews, "pageViews.csv");
  writeCSV(experimentViews, "experimentViews.csv");
  writeCSV(purchases, "purchases.csv");
  writeCSV(events, "events.csv");
});
