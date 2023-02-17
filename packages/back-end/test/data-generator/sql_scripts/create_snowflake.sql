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

CREATE OR REPLACE FILE FORMAT mycsvformat
  type = 'CSV'
  field_delimiter = ','
  skip_header = 1
  null_if = '\\N';

CREATE OR REPLACE STAGE csv_staging
  file_format = mycsvformat;

PUT file:///tmp/csv/*.csv @csv_staging auto_compress=true;

COPY INTO orders
  from @csv_staging/purchases.csv.gz
  file_format = (format_name = mycsvformat)
  on_error = 'skip_file';

COPY INTO sessions
  from @csv_staging/sessions.csv.gz
  file_format = (format_name = mycsvformat)
  on_error = 'skip_file';

COPY INTO events
  from @csv_staging/events.csv.gz
  file_format = (format_name = mycsvformat)
  on_error = 'skip_file';

COPY INTO experiment_Viewed
  from @csv_staging/experimentViews.csv.gz
  file_format = (format_name = mycsvformat)
  on_error = 'skip_file';

COPY INTO pages
  from @csv_staging/pageViews.csv.gz
  file_format = (format_name = mycsvformat)
  on_error = 'skip_file';

remove @csv_staging pattern='.*.csv.gz';