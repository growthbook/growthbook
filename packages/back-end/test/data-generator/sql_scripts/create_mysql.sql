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


LOAD DATA LOCAL INFILE '/tmp/csv/purchases.csv' INTO TABLE orders FIELDS TERMINATED BY ',' IGNORE 1 ROWS;
LOAD DATA LOCAL INFILE '/tmp/csv/sessions.csv' INTO TABLE sessions FIELDS TERMINATED BY ',' IGNORE 1 ROWS;
LOAD DATA LOCAL INFILE '/tmp/csv/events.csv' INTO TABLE events FIELDS TERMINATED BY ',' IGNORE 1 ROWS;
LOAD DATA LOCAL INFILE '/tmp/csv/experimentViews.csv' INTO TABLE experiment_viewed FIELDS TERMINATED BY ',' IGNORE 1 ROWS;
LOAD DATA LOCAL INFILE '/tmp/csv/pageViews.csv' INTO TABLE pages FIELDS TERMINATED BY ',' IGNORE 1 ROWS;