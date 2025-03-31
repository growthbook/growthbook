DROP TABLE IF EXISTS pages;
CREATE TABLE pages (
  user_id VARCHAR(8), 
  anonymous_id VARCHAR(64), 
  session_id VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  timestamp TIMESTAMP, 
  path VARCHAR(32)
);

DROP TABLE IF EXISTS viewed_experiment;
CREATE TABLE viewed_experiment (
  user_id VARCHAR(8), 
  anonymous_id VARCHAR(64), 
  session_id VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2),
  timestamp TIMESTAMP, 
  experiment_id VARCHAR(32),
  variation_id VARCHAR(32)
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  user_id VARCHAR(8), 
  anonymous_id VARCHAR(64), 
  session_id VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2),
  timestamp TIMESTAMP, 
  qty INTEGER,
  amount INTEGER
);

DROP TABLE IF EXISTS events;
CREATE TABLE events (
  value INTEGER,
  user_id VARCHAR(8), 
  anonymous_id VARCHAR(64), 
  session_id VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  timestamp TIMESTAMP, 
  event VARCHAR(32)
);

DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  user_id VARCHAR(8), 
  anonymous_id VARCHAR(64), 
  session_id VARCHAR(64), 
  browser VARCHAR(20), 
  country VARCHAR(2), 
  sessionStart TIMESTAMP, 
  pages INTEGER,
  duration INTEGER
);



\copy orders from '/tmp/csv/purchases.csv' WITH DELIMITER ',' CSV HEADER NULL AS '\N';
\copy sessions from '/tmp/csv/sessions.csv' WITH DELIMITER ',' CSV HEADER;
\copy events from '/tmp/csv/events.csv' WITH DELIMITER ',' CSV HEADER;
\copy viewed_experiment from '/tmp/csv/experimentViews.csv' WITH DELIMITER ',' CSV HEADER;
\copy pages from '/tmp/csv/pageViews.csv' WITH DELIMITER ',' CSV HEADER;
