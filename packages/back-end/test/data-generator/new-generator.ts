import fs from "fs";
import { GrowthBook } from "@growthbook/growthbook";
import normalSample from "@stdlib/random/base/normal";
import { addDays } from "date-fns";
import parseArgs from "minimist";

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
type SessionTableData = Omit<TableData, "timestamp"> & {
  duration: number;
  pages: number;
  sessionStart: string;
};
type ExperimentTableData = TableData & {
  experimentId: string;
  variationId: number;
};
type PurchaseTableData = TableData & {
  amount: number | null; // null will get written as \N to file
  qty: number;
};
type EventTableData = TableData & {
  value?: number;
  event: string;
};

interface DataTables {
  pageViews: PageViewTableData[];
  sessions: SessionTableData[];
  experimentViews: ExperimentTableData[];
  purchases: PurchaseTableData[];
  events: EventTableData[];
  userRetention: Record<string, number>;
}

interface SimulatorData {
  dataTables: DataTables;
  messyData: boolean;
  expKeyPrefix: string;
  startDate: Date;
  currentDate: Date;
  runLengthDays: number;
}

function getDateRangeCondition(
  startDate: Date,
  dateLength: number,
  startPct: number,
  endPct: number,
) {
  const s = addDays(new Date(startDate), startPct * dateLength);
  const e = addDays(new Date(startDate), endPct * dateLength);

  return {
    date: {
      $gte: s.toISOString().substring(0, 10),
      $lte: e.toISOString().substring(0, 10),
    },
  };
}

function setRandomTime(currentDate: Date) {
  currentDate.setHours(Math.floor(Math.random() * 12));
  currentDate.setMinutes(Math.floor(Math.random() * 50));
  currentDate.setSeconds(0);
}

function advanceTime(currentDate: Date, max = 61) {
  const seconds = normalInt(1, max);
  currentDate.setSeconds(currentDate.getSeconds() + seconds);
}

function trackExperiment(
  data: Omit<ExperimentTableData, "experimentId" | "variationId">,
  result: { inExperiment: boolean; variationId: number },
  experimentId: string,
  sim: SimulatorData,
) {
  if (!result.inExperiment) return;
  sim.dataTables.experimentViews.push({
    ...data,
    experimentId: sim.expKeyPrefix.concat("", experimentId),
    variationId: result.variationId,
    timestamp: getTimestamp(sim.currentDate),
  });
}

function trackEvent(
  data: Omit<EventTableData, "event">,
  event: string,
  sim: SimulatorData,
) {
  sim.dataTables.events.push({
    value: 0,
    ...data,
    event,
    timestamp: getTimestamp(sim.currentDate),
  });
}

function trackPurchase(data: PurchaseTableData, sim: SimulatorData) {
  sim.dataTables.purchases.push({
    ...data,
    timestamp: getTimestamp(sim.currentDate),
  });
}

function trackPageView(data: PageViewTableData, sim: SimulatorData) {
  sim.dataTables.pageViews.push({
    ...data,
    timestamp: getTimestamp(sim.currentDate),
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
  if (max < min) throw "Invalid value!";
  if (min === max) return min;

  const mean = (max - min) / 2 + min;
  const stddev = (max - min) / 3;

  const x = Math.round(normalSample(mean, stddev));
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

function viewHomepage(data: TableData, gb: GrowthBook, sim: SimulatorData) {
  // Land on home page
  trackPageView(
    {
      ...data,
      path: "/",
    },
    sim,
  );
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
    "homepage-nav-ios",
    sim,
  );

  advanceTime(sim.currentDate, 30);

  // Only some users open the navigation
  if (Math.random() < 0.5) {
    trackEvent(data, "Open Nav", sim);
  }

  // And some perform a search
  const searched = Math.random() < 0.8;
  if (searched) {
    trackEvent(data, "Search", sim);
  }

  advanceTime(sim.currentDate, 30);

  return !searched;
}

function viewSearchResults(
  data: TableData,
  gb: GrowthBook,
  sim: SimulatorData,
) {
  trackPageView(
    {
      ...data,
      path: "/search",
    },
    sim,
  );
  // A/B test on the search order (mixed, less people sorting manually, but more bounces)
  const res = gb.run({
    key: "results-order",
    // Bounce rate
    variations: [0.15, 0.12],
    condition: getDateRangeCondition(
      sim.startDate,
      sim.runLengthDays,
      0.05,
      0.35,
    ),
  });
  trackExperiment(data, res, "results-order", sim);
  advanceTime(sim.currentDate, 20);

  // Some people sort manually (depends on experiment variation)
  if (Math.random() < Math.pow(res.value, 2) * 5) {
    trackEvent(data, "Sort Results", sim);
  }

  // Bounce rate also depends on variation
  return Math.random() < 0.3 - res.value;
}

function viewItemPage(data: TableData, gb: GrowthBook, sim: SimulatorData) {
  // Id corresponds to price
  const itemId = Math.floor(Math.random() * 10 + 1);
  trackPageView(
    {
      ...data,
      path: `/item/${itemId}`,
    },
    sim,
  );
  // A/B test price display (loser, fewer qty purchased)
  let res = gb.run({
    key: "price-display",
    // Max qty purchased
    variations: [2, 1],
    condition: getDateRangeCondition(sim.startDate, sim.runLengthDays, 0, 0.9),
  });
  trackExperiment(data, res, "price-display", sim);
  const qty = normalInt(1, res.value);
  const amount = qty * itemId;

  // A/B test the add-to-cart CTA (winner)
  res = gb.run({
    key: "add-to-cart-cta",
    variations: [0.3, 0.36],
    condition: getDateRangeCondition(
      sim.startDate,
      sim.runLengthDays,
      0.0,
      1.0,
    ),
  });
  trackExperiment(data, res, "add-to-cart-cta", sim);

  advanceTime(sim.currentDate, 20);
  if (Math.random() < res.value) {
    trackEvent(
      {
        ...data,
        value: amount,
      },
      "Add to Cart",
      sim,
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

function viewCheckout(data: TableData, gb: GrowthBook, sim: SimulatorData) {
  trackPageView(
    {
      ...data,
      path: `/checkout`,
    },
    sim,
  );
  // A/B test checkout layout (variation 1 is worse, 2 is better)
  const res = gb.run({
    key: "checkout-layout",
    // Bounce rate
    variations: [0.3, 0.4, 0.25],
    condition: getDateRangeCondition(sim.startDate, sim.runLengthDays, 0, 1),
  });
  trackExperiment(data, res, "checkout-layout", sim);
  // add second "error" exposure with different value
  // for 10% of users. Used to test multiple exposures.
  if (sim.messyData && Math.random() < 0.1) {
    trackExperiment(
      data,
      { inExperiment: true, variationId: 0 },
      "checkout-layout",
      sim,
    );
  }
  advanceTime(sim.currentDate, 30);

  // add activation metric that the checkout layout actually loads
  // (and is unaffected by experiment, which otherwise would cause bias)
  if (Math.random() < 0.9) {
    trackEvent(data, "Cart Loaded", sim);
    return Math.random() < res.value;
  }
  // bounce all those not activated
  return true;
}

function purchase(
  data: TableData,
  gb: GrowthBook,
  sim: SimulatorData,
  qty: number,
  price: number | null,
) {
  trackPageView(
    {
      ...data,
      path: `/success`,
    },
    sim,
  );
  // Pretend we gift people items randomly and the price is then 0, but
  // we set it to NULL (just as a way to simulate NULL values in data)
  if (sim.messyData && Math.random() < 0.15) {
    price = null;
  }
  trackPurchase(
    {
      ...data,
      qty: qty,
      amount: price,
    },
    sim,
  );
  advanceTime(sim.currentDate, 30);

  // A/B test confirmation email (winner, improved retention)
  const res = gb.run({
    key: "confirmation-email",
    // How much retention is gained (out of 100)
    variations: [5, 10],
    condition: getDateRangeCondition(
      sim.startDate,
      sim.runLengthDays,
      0.7,
      0.9,
    ),
  });
  trackExperiment(data, res, "confirmation-email", sim);
  sim.dataTables.userRetention[parseInt(data.userId)] += normalInt(
    res.value - 10,
    res.value + 10,
  );
}

function getTimestamp(currentDate: Date) {
  return currentDate.toISOString().substring(0, 19).replace("T", " ");
}

async function simulateSession(
  userId: number,
  anonymousId: string,
  sim: SimulatorData,
): Promise<Omit<SessionTableData, "duration" | "pages">> {
  setRandomTime(sim.currentDate);
  const browser = getBrowser();
  const commonData = {
    userId: userId + "",
    anonymousId: browser + anonymousId,
    sessionId: Math.random() + "",
    browser,
    country: getCountry(userId),
  };
  const eventData: TableData = {
    ...commonData,
    timestamp: "",
  };
  const sessionData: Omit<SessionTableData, "duration" | "pages"> = {
    ...commonData,
    sessionStart: getTimestamp(sim.currentDate),
  };

  const gb = new GrowthBook({
    attributes: {
      id: userId,
      anonId: eventData.anonymousId,
      date: sim.currentDate.toISOString().substring(0, 10),
      browser: eventData.browser,
      country: eventData.country,
    },
  });

  let bounce = viewHomepage(eventData, gb, sim);
  if (bounce) return sessionData;

  bounce = viewSearchResults(eventData, gb, sim);
  if (bounce) return sessionData;

  // Views a couple items
  let qty = 0;
  let price = 0;
  // A/B test that shows recommended items (increases number viewed)
  const res = gb.run({
    key: "recommended-items",
    variations: [4, 4.2, 4.4],
    condition: getDateRangeCondition(
      sim.startDate,
      sim.runLengthDays,
      0.2,
      0.5,
    ),
  });
  const itemsViewed = normalInt(1, res.value);
  for (let i = 0; i < itemsViewed; i++) {
    const item = viewItemPage(eventData, gb, sim);
    qty += item.qty;
    price += item.amount;
  }
  if (!qty) return sessionData;

  bounce = viewCheckout(eventData, gb, sim);
  if (bounce) return sessionData;

  purchase(eventData, gb, sim, qty, price);

  return sessionData;
}

const anonymousIds: Record<string, string> = {};
async function simulate(sim: SimulatorData, numUsers: number) {
  for (let i = 0; i < sim.runLengthDays; i++) {
    for (let j = 0; j < numUsers; j++) {
      // Space out people's starting days
      const firstDay = (j / numUsers) * (sim.runLengthDays - 30);
      if (i < firstDay) continue;

      // If user is retained
      const r = Math.random() * 800;
      if (!(j in sim.dataTables.userRetention)) {
        sim.dataTables.userRetention[j] = 100;
      }
      if (r >= sim.dataTables.userRetention[j]) continue;

      // Small chance of clearing cookies
      if (!anonymousIds[j] || Math.random() < 0.05) {
        anonymousIds[j] = j + "__" + Math.random() + "";
      }

      const startingPageviews = sim.dataTables.pageViews.length;
      const data = await simulateSession(j, anonymousIds[j], sim);
      const duration = Math.round(
        (sim.currentDate.getTime() -
          new Date(data.sessionStart + "Z").getTime()) /
          1000,
      );
      sim.dataTables.sessions.push({
        ...data,
        pages: sim.dataTables.pageViews.length - startingPageviews,
        duration,
      });

      sim.dataTables.userRetention[j] -= normalInt(20, 40);
    }
    sim.currentDate = addDays(sim.currentDate, 1);
  }
}

function writeCSV(
  objs: Record<string, unknown>[],
  output_dir: string,
  filename: string,
) {
  const path = output_dir + "/" + filename;
  const firstRow = objs.shift();
  if (!firstRow) return;
  const rows: string[][] = [];
  const headers = Object.keys(firstRow);
  rows.push(headers);
  for (let i = 0; i < objs.length; i++) {
    const row: string[] = [];
    for (let j = 0; j < headers.length; j++) {
      row.push(String(objs[i][headers[j]] ?? "\\N"));
    }
    rows.push(row);
  }
  const contents = rows.map((row) => row.join(",")).join("\n") + "\n";
  fs.writeFileSync(path, contents);
}

function generateAndWriteData({
  startDate,
  runLengthDays,
  outputDir,
  numUsers,
  messyData,
  expKeyPrefix,
}: {
  startDate: Date;
  runLengthDays: number;
  outputDir: string;
  numUsers: number;
  messyData: boolean;
  expKeyPrefix: string;
}) {
  const sim: SimulatorData = {
    dataTables: {
      pageViews: [],
      sessions: [],
      experimentViews: [],
      purchases: [],
      events: [],
      userRetention: {},
    },
    messyData: messyData,
    expKeyPrefix: expKeyPrefix,
    startDate: startDate,
    currentDate: new Date(startDate),
    runLengthDays: runLengthDays,
  };

  simulate(sim, numUsers).then(async () => {
    const sortDate = (a: TableData, b: TableData) =>
      a.timestamp.localeCompare(b.timestamp);

    sim.dataTables.sessions.sort((a, b) =>
      a.sessionStart.localeCompare(b.sessionStart),
    );
    sim.dataTables.pageViews.sort(sortDate);
    sim.dataTables.experimentViews.sort(sortDate);
    sim.dataTables.purchases.sort(sortDate);
    sim.dataTables.events.sort(sortDate);

    console.log({
      users: numUsers,
      sessions: sim.dataTables.sessions.length,
      pageViews: sim.dataTables.pageViews.length,
      experiments: sim.dataTables.experimentViews.length,
      purchases: sim.dataTables.purchases.length,
      events: sim.dataTables.events.length,
    });

    console.log(`Writing CSVs to '${outputDir}'...`);
    fs.mkdirSync(outputDir, { recursive: true });
    writeCSV(sim.dataTables.sessions, outputDir, "sessions.csv");
    writeCSV(sim.dataTables.pageViews, outputDir, "pageViews.csv");
    writeCSV(sim.dataTables.experimentViews, outputDir, "experimentViews.csv");
    writeCSV(sim.dataTables.purchases, outputDir, "purchases.csv");
    writeCSV(sim.dataTables.events, outputDir, "events.csv");
  });
}

const {
  days: daysArg,
  "start-date": startDateArg,
  "user-count": userCountArg,
  "csv-dir": csvDirArg,
  "messy-data": messyDataArg,
  "key-prefix": keyPrefixArg,
} = parseArgs(process.argv.slice(2), {
  string: [
    "days",
    "start-date",
    "user-count",
    "csv-dir",
    "messy-data",
    "key-prefix",
  ],
  default: {
    days: "60",
    "user-count": "10000",
    "csv-dir": "/tmp/csv",
    "messy-data": "true",
    "key-prefix": "",
  },
});

const runLengthDays = Number(daysArg);
const numUsers = Number(userCountArg);
const messyData = messyDataArg.toLowerCase() === "true";

const startDate = (() => {
  if (startDateArg) return new Date(startDateArg);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - runLengthDays);
  return startDate;
})();

const params = {
  startDate,
  runLengthDays,
  outputDir: csvDirArg,
  numUsers,
  messyData,
  expKeyPrefix: keyPrefixArg,
};

console.log(`Generation params: ${JSON.stringify(params, null, 2)}`);
console.log("Generating dummy data: ...");
generateAndWriteData(params);
