/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const ObjectToCsv = require("objects-to-csv");

const args = process.argv.slice(2);

const outputDirectory = "./dummy/";

fs.mkdirSync(outputDirectory, { recursive: true });

// input data:
const p = require("./data.json");

const numUsers = args[0] ? parseInt(args[0]) : 10000;
const newPageChance = 0.45;
const newSessionChance = 0.3;
const signupChance = 0.2;
const signupConversionChance = 0.5;
const purchaseRequiresReg = true;
const purchaseChance = 0.1; // if you have to be registered as well, so the actual odds of this are much lower.
const purchaseAmount = [10, 100]; // min price, max price.
const experimentChance = 0.8; // for each user, the precent chance they'll be in an experiment.
const startUserId = 1;
const startSessionId = 1;

// time will be divided roughly evenly between these dates.
const d = new Date();
d.setMonth(d.getMonth() - 2);
const startDate = d.toDateString();
const endDate = new Date().toDateString();

function pickRandom(options, skew = 1) {
  const n = Math.pow(options.length, skew);
  const i = Math.floor(Math.pow(Math.random() * n, 1 / skew));
  return options[options.length - i - 1];
}

// max time intervals between events, in seconds (randomized):
const smallTimeEvent = 20; // twenty seconds
const largeTimeEvent = 24 * 60 * 60; // sessions, 1 day

const genders = ["male", "female", ""];
const browsers = [
  "chrome for android",
  "mobile safari",
  "chrome desktop",
  "safari desktop",
  "edge desktop",
  "firefox desktop",
];
const geos = ["US", "CA", "UK", "Other", "IN"];

// ---

const users = [];
const pages = [];
const experiment_viewed = [];
const viewed_signup = [];
const signup = [];
const sessions = [];
const purchase = [];

const dateRange = Date.parse(endDate) - Date.parse(startDate);
const incrementAvg = dateRange / numUsers;

let currentTime = Date.parse(startDate);
let sessionId = startSessionId;

const allPages = [
  ...p.pages.core,
  ...p.pages.blog,
  ...p.pages.core,
  ...p.pages.core,
  ...p.pages.core,
];

for (let i = 1; i < numUsers; i++) {
  // increase the clock by a bit
  currentTime =
    currentTime + incrementAvg + (Math.random() - 0.5) * incrementAvg;

  // save the time into a user space, which will be incremented more agressively
  let userTime = currentTime;
  const userId = startUserId + i;
  let registered = false;
  let purchased = false;
  let userSignupChance = signupChance;
  let userRegisterChance = signupConversionChance;
  let userPurchaseChance = purchaseChance;
  let userPurchaseAmount = purchaseAmount;
  let userNewPageChance = newPageChance;

  let sessionInfo = {
    session_id: sessionId,
    user_id: userId,
    anonymous_id: userId,
    date_start: format_time(userTime),
    date_end: "",
    duration_seconds: 0,
    num_pages: 1,
  };

  // add to user table
  users.push({
    user_id: userId,
    anonymous_id: userId,
    received_at: format_time(userTime),
    gender: genders[Math.floor(Math.random() * genders.length)],
    geo_country: pickRandom(geos, 3),
  });

  // add a page view
  pages.push({
    user_id: userId,
    anonymous_id: userId,
    received_at: format_time(userTime),
    path: allPages[Math.floor(Math.random() * allPages.length)],
  });

  // do we put them in an experiment?
  p.experiments.forEach((exp) => {
    if (Math.random() >= experimentChance) return;
    const varIndex = Math.round(Math.random()); // 0 or 1
    experiment_viewed.push({
      user_id: userId,
      anonymous_id: userId,
      received_at: format_time(userTime),
      experiment_id: exp.id,
      variation_id: varIndex,
      user_agent: pickRandom(browsers, 2),
    });
    // does this experiment effect the outcome of anything?
    if (varIndex > 0) {
      if (exp.effects === "purchase") {
        userPurchaseChance *= exp.effectWeight;
      } else if (exp.effects === "purchaseAmount") {
        userPurchaseChance *= exp.effectWeight;
        userPurchaseAmount = exp.amount;
      } else if (exp.effects === "registration") {
        userRegisterChance *= exp.effectWeight;
      } else if (exp.effects === "signup") {
        userSignupChance *= exp.effectWeight;
      } else if (exp.effects === "pagesPerVisit") {
        userNewPageChance *= exp.effectWeight;
      }
    }
  });

  userTime = increment_time(userTime);

  while (Math.random() < userNewPageChance) {
    if (Math.random() < newSessionChance) {
      // lets end the previous session and start a new one:
      (sessionInfo.date_end = format_time(userTime)),
        // convert to seconds
        (sessionInfo.duration_seconds = Math.round(
          (Date.parse(sessionInfo.date_end) -
            Date.parse(sessionInfo.date_start)) /
            1000
        ));

      sessions.push({ ...sessionInfo });
      sessionId++;
      userTime = increment_time(userTime, true);

      sessionInfo = {
        session_id: sessionId,
        user_id: userId,
        anonymous_id: userId,
        date_start: format_time(userTime),
        date_end: "",
        duration_seconds: 0,
        num_pages: 1,
      };
    }

    // add page:
    pages.push({
      user_id: userId,
      anonymous_id: userId,
      received_at: format_time(userTime),
      path: allPages[Math.floor(Math.random() * allPages.length)],
    });
    // add to session visit
    sessionInfo.num_pages++;

    // registration:
    if (!registered && Math.random() < userSignupChance) {
      // signup viewed:
      viewed_signup.push({
        user_id: userId,
        anonymous_id: userId,
        received_at: format_time(userTime),
      });

      // add the register flow pages:

      userTime = increment_time(userTime);
      pages.push({
        user_id: userId,
        anonymous_id: userId,
        received_at: format_time(userTime),
        path: p.pages.register[0],
      });
      sessionInfo.num_pages++;

      // did they actual sign up?
      if (Math.random() < userRegisterChance) {
        registered = true;
        userTime = increment_time(userTime);

        pages.push({
          user_id: userId,
          anonymous_id: userId,
          received_at: format_time(userTime),
          path: p.pages.register[1],
        });
        sessionInfo.num_pages++;

        signup.push({
          user_id: userId,
          anonymous_id: userId,
          received_at: format_time(userTime),
        });
      }
    }

    if (
      ((purchaseRequiresReg && registered) || !purchaseRequiresReg) &&
      !purchased &&
      Math.random() < userPurchaseChance
    ) {
      purchased = true;

      // add the purchase flow pages:
      for (let n = 0; n < p.pages.purchase.length; n++) {
        userTime = increment_time(userTime);
        pages.push({
          user_id: userId,
          anonymous_id: userId,
          received_at: format_time(userTime),
          path: p.pages.purchase[n],
        });
        sessionInfo.num_pages++;
      }
      // add purchase to purchase stats
      purchase.push({
        user_id: userId,
        anonymous_id: userId,
        received_at: format_time(userTime),
        amount: Math.round(
          Math.random() * (userPurchaseAmount[1] - userPurchaseAmount[0]) +
            userPurchaseAmount[0]
        ),
      });
    }

    userTime = increment_time(userTime);
  }

  // save the session info:
  sessionInfo.date_end = format_time(userTime);
  sessionInfo.duration_seconds = Math.round(
    (Date.parse(sessionInfo.date_end) - Date.parse(sessionInfo.date_start)) /
      1000
  );
  sessions.push({ ...sessionInfo });
  sessionId++;
}

// helper functions:

function increment_time(t, large) {
  if (large) return t + Math.round(Math.random() * largeTimeEvent * 1000);

  return t + Math.round(Math.random() * smallTimeEvent * 1000);
}

function format_time(t) {
  const m = new Date(t);
  return m.toISOString().substr(0, 19).replace(/T/, " ");
}

function dateSort(a, b) {
  if (Date.parse(a.received_at) > Date.parse(b.received_at)) {
    return 1;
  } else if (Date.parse(a.received_at) < Date.parse(b.received_at)) {
    return -1;
  }
  return 0;
}

const experiments = {};
experiment_viewed.forEach((e) => {
  experiments[e.experiment_id] = experiments[e.experiment_id] || [0, 0];
  experiments[e.experiment_id][e.variation_id]++;
});
console.log(experiments);

// Sort by date and write to file:

new ObjectToCsv(users.sort(dateSort)).toDisk(outputDirectory + "users.csv");
console.log("saved ", outputDirectory + "users.csv", users.length);
new ObjectToCsv(pages.sort(dateSort)).toDisk(outputDirectory + "pages.csv");
console.log("saved ", outputDirectory + "pages.csv", pages.length);
new ObjectToCsv(sessions.sort(dateSort)).toDisk(
  outputDirectory + "sessions.csv"
);
console.log("saved ", outputDirectory + "sessions.csv", sessions.length);
new ObjectToCsv(experiment_viewed.sort(dateSort)).toDisk(
  outputDirectory + "experiment_viewed.csv"
);
console.log(
  "saved ",
  outputDirectory + "experiment_viewed.csv",
  experiment_viewed.length
);
new ObjectToCsv(viewed_signup.sort(dateSort)).toDisk(
  outputDirectory + "viewed_signup.csv"
);
console.log(
  "saved ",
  outputDirectory + "viewed_signup.csv",
  viewed_signup.length
);
new ObjectToCsv(signup.sort(dateSort)).toDisk(outputDirectory + "signup.csv");
console.log("saved ", outputDirectory + "signup.csv", signup.length);
new ObjectToCsv(purchase.sort(dateSort)).toDisk(
  outputDirectory + "purchase.csv"
);
console.log("saved ", outputDirectory + "purchase.csv", purchase.length);

fs.writeFileSync(
  outputDirectory + "mongo.json",
  JSON.stringify({
    startDate,
    endDate,
    experiments: Object.keys(experiments),
  })
);
