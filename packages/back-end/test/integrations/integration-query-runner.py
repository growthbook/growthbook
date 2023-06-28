from abc import ABC, abstractmethod
from dataclasses import dataclass
import json
from decimal import Decimal
import sys
import time

import clickhouse_connect
from databricks import sql as databricks_sql
from dotenv import dotenv_values
from google.oauth2 import service_account
from google.cloud import bigquery
import prestodb
import mysql.connector
import psycopg2
import psycopg2.extras
import sqlfluff
import snowflake.connector
import redshift_connector
import pyodbc
import pandas as pd

CACHE_FILE = "/tmp/json/cache.json"
QUERIES_FILE = "/tmp/json/queries.json"
RESULT_FILE_PREFIX = "/tmp/json/query_results"
# .env file should be in the same folder as this script
# path below is relative to the package where this script
# gets executed by yarn
ENV_FILE = "./test/integrations/.env"

CONNECTION_FAILED_ERROR = "runner configured, but connection failed"

config = {**dotenv_values(ENV_FILE)}

@dataclass
class QueryResult:
    rows: list[dict]
    stats: list[dict] = None

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            # similar to what JS does (all number are float)
            return float(obj)
        return json.JSONEncoder.default(self, obj)


class sqlRunner(ABC):
    def __init__(self):
        self.open_connection()

    @abstractmethod
    def open_connection(self):
        pass

    def get_query_result(self, sql: str) -> dict:
        starttime = time.time()
        query_result = self.run_query(sql)
        return {
            "walltime_seconds": time.time() - starttime,
            "rows": query_result.rows,
            "stats": query_result.stats,
        }

    @abstractmethod
    def run_query(self, sql: str) -> QueryResult:
        pass

    def close_connection(self):
        self.connection.close()


class mysqlRunner(sqlRunner):
    def open_connection(self):
        self.connection = mysql.connector.connect(
            host=config["MYSQL_TEST_HOST"],
            user=config["MYSQL_TEST_USER"],
            database=config["MYSQL_TEST_DATABASE"],
            password=config["MYSQL_TEST_PASSWORD"],
        )
        self.cursor_kwargs = {"dictionary": True, "buffered": True}

    def run_query(self, sql: str) -> QueryResult:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            return QueryResult(rows=cursor.fetchall())


class postgresRunner(sqlRunner):
    def open_connection(self):
        self.connection = psycopg2.connect(
            host=config["POSTGRES_TEST_HOST"],
            user=config["POSTGRES_TEST_USER"],
            dbname=config["POSTGRES_TEST_DATABASE"],
        )
        self.cursor_kwargs = {"cursor_factory": psycopg2.extras.RealDictCursor}

    def run_query(self, sql: str) -> QueryResult:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            res = []
            for row in cursor.fetchall():
                res.append(dict(row))
            return QueryResult(rows=res)


class snowflakeRunner(sqlRunner):
    def open_connection(self):
        self.connection = snowflake.connector.connect(
            user=config["SNOWFLAKE_TEST_USER"],
            password=config["SNOWFLAKE_TEST_PASSWORD"],
            account=config["SNOWFLAKE_TEST_ACCOUNT"],
            database=config["SNOWFLAKE_TEST_DATABASE"],
            schema=config["SNOWFLAKE_TEST_SCHEMA"],
        )
        self.cursor_kwargs = {"cursor_class": snowflake.connector.DictCursor}

    def run_query(self, sql: str) -> QueryResult:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            res = cursor.execute(sql).fetchall()
            # lower case col names
            return QueryResult(rows=[{k.lower(): v for k, v in row.items()} for row in res])


class prestoRunner(sqlRunner):
    def open_connection(self):
        self.connection = prestodb.dbapi.connect(
            host=config["PRESTO_TEST_HOST"],
            port=config["PRESTO_TEST_PORT"],
            user=config["PRESTO_TEST_USER"],
            catalog=config["PRESTO_TEST_CATALOG"],
            schema=config["PRESTO_TEST_SCHEMA"],
        )
        self.cursor_kwargs = {}

    def run_query(self, sql: str) -> QueryResult:
        cursor = self.connection.cursor(**self.cursor_kwargs)
        cursor.execute(sql)
        rows = cursor.fetchall()
        colnames = [col[0] for col in cursor.description]
        res = [dict(zip(colnames, row)) for row in rows]
        return QueryResult(rows=res)


class databricksRunner(sqlRunner):
    def open_connection(self):
        self.connection = databricks_sql.connect(
            server_hostname=config["DATABRICKS_TEST_HOST"],
            http_path=config["DATABRICKS_TEST_PATH"],
            access_token=config["DATABRICKS_TEST_TOKEN"],
        )

    def run_query(self, sql: str) -> QueryResult:
        cursor = self.connection.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        return QueryResult(rows=[row.asDict() for row in rows])


class bigqueryRunner(sqlRunner):
    def open_connection(self):
        self.connection = bigquery.Client(
            credentials=service_account.Credentials.from_service_account_file(
                config["GOOGLE_APPLICATION_CREDENTIALS"]
            )
        )

    def run_query(self, sql: str, perf_iterations: int = 1) -> QueryResult:
        stats = []
        job_config = bigquery.QueryJobConfig(use_query_cache=False)
        for i in range(perf_iterations):
            query_job = self.connection.query(query=sql, job_config=job_config)
            res = query_job.result()
            stat_dict = query_job._properties['statistics']
            stat_dict['test_run_i'] = i
            stats.append(stat_dict)
        # just keep last result
        res_rows = [dict(row) for row in res]
        return QueryResult(rows=res_rows, stats=stats)


class clickhouseRunner(sqlRunner):
    def open_connection(self):
        self.connection = clickhouse_connect.get_client(
            host=config['CLICKHOUSE_CLOUD_HOSTNAME'],
            port=8443, 
            username=config['CLICKHOUSE_CLOUD_USERNAME'], 
            password=config['CLICKHOUSE_CLOUD_PASSWORD'],
        )
        self.cursor_kwargs = {}

    def run_query(self, sql: str) -> QueryResult:
        dfs = []
        with self.connection.query_df_stream(sql) as df_stream:
            for df in df_stream:
                dfs.append(df)
        return QueryResult(rows=pd.concat(dfs).to_dict('records'))


class mssqlRunner(sqlRunner):
    def open_connection(self):
        self.connection = pyodbc.connect(
            'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};ENCRYPT=yes;UID={username};PWD={password}'
        ).format(
            server=config['MSSQL_TEST_SERVER'],
            username=config['MSSQL_TEST_USER'],
            password=config['MSSQL_TEST_PASSWORD']    
        )

    def run_query(self, sql: str) -> QueryResult:
        cursor = self.connection.cursor()
        cursor.execute(sql)
        return QueryResult(rows=[row.asDict() for row in cursor.fetchall()])

class redshiftRunner(sqlRunner):
    def open_connection(self):
        self.connection = redshift_connector.connect(
            host=config['REDSHIFT_TEST_HOST'],
            database=config['REDSHIFT_TEST_DATABASE'],
            user=config['REDSHIFT_TEST_USER'],
            password=config['REDSHIFT_TEST_PASSWORD']
        )

    def run_query(self, sql: str) -> QueryResult:
        cursor = self.connection.cursor()
        cursor.execute(sql)
        return QueryResult(rows=[])
        #return QueryResult(rows=cursor.fetch_dataframe().to_dict('records'))



class mssqlRunner(sqlRunner):
    def open_connection(self):
        self.connection = pyodbc.connect(
            'DRIVER=ODBC Driver 17 for SQL Server;SERVER={server};ENCRYPT=yes;UID={username};PWD={password};DATABASE={database};TrustServerCertificate=yes;'.format(
                server=config['MSSQL_TEST_SERVER'],
                username=config['MSSQL_TEST_USER'],
                password=config['MSSQL_TEST_PASSWORD'],
                database=config['MSSQL_TEST_DATABASE']
            )
        )

    def run_query(self, sql: str) -> QueryResult:
        cursor = self.connection.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        colnames = [col[0] for col in cursor.description]
        res = [dict(zip(colnames, row)) for row in rows]
        return QueryResult(rows=res)


class dummyRunner(sqlRunner):
    def __init__(self, error_message: str):
        super().__init__()
        self.error_message = error_message

    def open_connection(self):
        self.connection = None

    def get_query_result(self, sql: str) -> dict:
        return {"error": self.error_message}

    def run_query(self, sql: str):
        pass

    def close_connection(self):
        pass


def read_queries_json() -> dict:
    with open(QUERIES_FILE, "r") as f:
        data = json.load(f)
    return data


def print_sql(txt, insert_line_numbers=False):
    if insert_line_numbers:
        sql_string = "\n".join(
            [f"{n+1:03d} {line}" for n, line in enumerate(txt.split("\n"))]
        )
    else:
        sql_string = "\n".join([f"{line}" for n, line in enumerate(txt.split("\n"))])
    print(sql_string)


def read_queries_cache() -> dict:
    try:
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print("Failed to load query cache, creating a new one...")
        return {}


def write_cache(cache):
    cache_string = json.dumps(cache, cls=DecimalEncoder)
    with open(CACHE_FILE, "w") as outfile:
        outfile.write(cache_string)


def get_sql_runner(engine) -> sqlRunner:
    try:
        if engine == "mysql":
            return mysqlRunner()
        elif engine == "postgres":
            return postgresRunner()
        elif engine == "bigquery":
            return bigqueryRunner()
        elif engine == "snowflake":
            return snowflakeRunner()
        elif engine == "presto":
            return prestoRunner()
        #elif engine == "databricks":
        #    return databricksRunner()
        elif engine == "mssql":
            return mssqlRunner()
        elif engine == "clickhouse":
            return clickhouseRunner()
        elif engine == "redshift":
            return redshiftRunner()
        else:
            return dummyRunner("no runner configured")
    except Exception as e:
        print(e)
        print(f"failure connection to {engine} engine")
        return dummyRunner(CONNECTION_FAILED_ERROR)


def execute_query(sql: str, runner: sqlRunner) -> dict:
    return runner.get_query_result(sql)


def validate(test_case):
    errors = sqlfluff.lint(
        test_case["sql"],
        dialect=test_case["engine"],
        exclude_rules=[
            "L003",
            "L006",
            "L009",
            "L010",
            "L011",
            "L014",
            "L016",
            "L017",
            "L022",
            "L027",  # allows potentially ambiguous column references
            "L028",
            # Keywords should not be used as identifiers error
            # Ignored bc timestamp is used as col. Could fix.
            "L029",
            "L030",
            "L031",
            "L035",  # allow NULL in case when
            "L034",
            "L051",  # allows JOIN instead of INNER JOIN
            "L063",
            "L064",  # allows " instead of ' around dates
            "L067",
            # clickhouse complained about lots of whitespace issues
            "L001",
            "L005",
            "L071",
            "L019",
            "L008",
            "L036",
            "L018",
            "L048",
        ],
    )
    if len(errors) > 0:
        print(test_case["name"])
        print(test_case["engine"])
        print(print_sql(test_case["sql"], insert_line_numbers=True))
        for error in errors:
            print(error)
        raise ValueError("sqlfluff error")


def main():
    test_cases = read_queries_json()

    cache = read_queries_cache()
    results = []
    runners = {}

    # presto, redshift, athena have problems with leading __ so excluded for now
    # mssql is not in sqlfluff
    nonlinted_engines = ["presto", "redshift", "athena", "mssql"]

    for test_case in test_cases:
        engine = test_case["engine"]
        key = engine + "::" + test_case["sql"]

        if key in cache:
            update_fields = ['engine', 'name']
            results.append({
                # prevent drawing wrong test case from cache when different
                # configs produce the exact same SQL
                **{k: v for k, v in cache[key].items() if k not in update_fields},
                **{k: v for k, v in test_case.items() if k in update_fields}
            })
        else:
            if engine not in nonlinted_engines:
                validate(test_case)
            if engine not in runners:
                runners[engine] = get_sql_runner(engine)
            result = execute_query(test_case["sql"], runners[engine])
            result.update(test_case)
            cache[key] = result
            write_cache(cache)
            results.append(result)

    for engine, runner in runners.items():
        runner.close_connection()
    # Learn what branch and write out results
    branch_name = sys.argv[1].replace("/", "") if len(sys.argv) > 1 else ""
    res_filename = f"{RESULT_FILE_PREFIX}_{branch_name}.json"
    print(f"Writing query result json to {res_filename}...")
    with open(res_filename, "w") as f:
        f.write(json.dumps(results, cls=DecimalEncoder, indent=2))
    return results


if __name__ == "__main__":
    main()
