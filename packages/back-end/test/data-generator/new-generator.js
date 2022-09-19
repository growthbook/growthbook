const growthbook = require("@growthbook/growthbook");
const jstat = require("jstat");
const fs = require("fs");
const ObjectToCsv = require("objects-to-csv");

const NUM_USERS = 10000;

const userRetention = {};

const startDate = new Date();
startDate.setDate(startDate.getDate() - 90);
function getDateRangeCondition(start, end) {
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

const experimentViews = [];
function trackExperiment({ sessionStart, ...data }, result, experimentId) {
  if (!result.inExperiment) return;
  experimentViews.push({
    ...data,
    experimentId,
    variationId: result.variationId,
    timestamp: getTimestamp(),
  });
}

const events = [];
function trackEvent({ sessionStart, ...data }, event) {
  events.push({
    value: 0,
    ...data,
    event,
    timestamp: getTimestamp(),
  });
}

const purchases = [];
function trackPurchase({ sessionStart, ...data }) {
  purchases.push({
    ...data,
    timestamp: getTimestamp(),
  });
}

const pageViews = [];
function trackPageView({ sessionStart, ...data }) {
  pageViews.push({
    ...data,
    timestamp: getTimestamp(),
  });
}

function getBrowser() {
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

function normalInt(min, max) {
  const mean = (max - min) / 2 + min;
  const stddev = (max - min) / 3;

  const x = Math.round(jstat.normal.sample(mean, stddev));
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function getCountry(userId) {
  const i = userId % 10;
  if (i < 6) return "US";
  if (i < 8) return "UK";
  if (i < 9) return "CA";
  return "AU";
}

function viewHomepage(data, gb) {
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

function viewSearchResults(data, gb) {
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

function viewItemPage(data, gb) {
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

function viewCheckout(data, gb) {
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

function purchase(data, gb, qty, price) {
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

const sessions = [];
async function simulateSession(userId, anonymousId) {
  setRandomTime();
  const browser = getBrowser();
  const commonEventData = {
    userId: userId + "",
    anonymousId: browser + anonymousId,
    sessionId: Math.random() + "",
    browser,
    sessionStart: getTimestamp(),
    country: getCountry(userId),
  };

  const gb = new growthbook.GrowthBook({
    attributes: {
      id: userId,
      anonId: commonEventData.anonymousId,
      date: currentDate.toISOString().substring(0, 10),
      browser: commonEventData.browser,
      country: commonEventData.country,
    },
  });

  let bounce = viewHomepage(commonEventData, gb);
  if (bounce) return commonEventData;

  bounce = viewSearchResults(commonEventData, gb);
  if (bounce) return commonEventData;

  // Views a couple items
  let qty = 0;
  let price = 0;
  // A/B test that shows recommended items (increases number viewed)
  let res = gb.run({
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
  if (!qty) return commonEventData;

  bounce = viewCheckout(commonEventData, gb);
  if (bounce) return commonEventData;

  purchase(commonEventData, gb, qty, price);

  return commonEventData;
}

const anonymousIds = {};
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
simulate().then(async () => {
  console.log("Done!");

  const sortDate = (a, b) => a.timestamp.localeCompare(b.timestamp);

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

  //fs.mkdirSync("csv");
  fs.mkdirSync("/tmp/csv", { recursive: true });
  await new ObjectToCsv(sessions).toDisk("/tmp/csv/sessions.csv");
  await new ObjectToCsv(pageViews).toDisk("/tmp/csv/pageViews.csv");
  await new ObjectToCsv(experimentViews).toDisk("/tmp/csv/experimentViews.csv");
  await new ObjectToCsv(purchases).toDisk("/tmp/csv/purchases.csv");
  await new ObjectToCsv(events).toDisk("/tmp/csv/events.csv");
});

function getSample(userId) {
  return {
    userId,
    sessions: sessions
      .filter((x) => x.userId === userId)
      .map((s) => {
        const filter = (x) =>
          x.userId === userId && x.sessionId === s.sessionId;
        const combined = events
          .filter(filter)
          .concat(
            pageViews.filter(filter).map((p) => ({ ...p, event: "Page View" }))
          )
          .concat(
            experimentViews
              .filter(filter)
              .map((e) => ({ ...e, event: "Experiment Viewed" }))
          )
          .map(({ userId, sessionStart, sessionId, anonymousId, ...other }) => {
            return other;
          });
        combined.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return {
          ...s,
          events: combined,
        };
      }),
  };
}

// console.log(JSON.stringify(getSample("100"), null, 2));
