DROP TABLE IF EXISTS pages;
CREATE TABLE pages (
  userId VARCHAR(8), 
  anonymousId VARCHAR(64), 
  sessionId VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  timestamp TIMESTAMP, 
  path VARCHAR(32)
);

DROP TABLE IF EXISTS experiment_viewed;
CREATE TABLE experiment_viewed (
  userId VARCHAR(8), 
  anonymousId VARCHAR(64), 
  sessionId VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2),
  timestamp TIMESTAMP, 
  experimentId VARCHAR(32),
  variationId VARCHAR(32)
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  userId VARCHAR(8), 
  anonymousId VARCHAR(64), 
  sessionId VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2),
  timestamp TIMESTAMP, 
  qty INTEGER,
  amount INTEGER
);

DROP TABLE IF EXISTS events;
CREATE TABLE events (
  value INTEGER,
  userId VARCHAR(8), 
  anonymousId VARCHAR(64), 
  sessionId VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  timestamp TIMESTAMP, 
  event VARCHAR(32)
);

DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  userId VARCHAR(8), 
  anonymousId VARCHAR(64), 
  sessionId VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  sessionStart TIMESTAMP, 
  pages INTEGER,
  duration INTEGER
);



\copy orders from '/tmp/csv/purchases.csv' WITH DELIMITER ',' CSV HEADER NULL AS '\N';
\copy sessions from '/tmp/csv/sessions.csv' WITH DELIMITER ',' CSV HEADER;
\copy events from '/tmp/csv/events.csv' WITH DELIMITER ',' CSV HEADER;
\copy experiment_viewed from '/tmp/csv/experimentViews.csv' WITH DELIMITER ',' CSV HEADER;
\copy pages from '/tmp/csv/pageViews.csv' WITH DELIMITER ',' CSV HEADER;