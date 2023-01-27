from abc import ABC, abstractmethod
import json
from decimal import Decimal
import os
import sys
import time

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

CACHE_FILE = "/tmp/json/cache.json"
QUERIES_FILE = "/tmp/json/queries.json"
RESULT_FILE_PREFIX = "/tmp/json/query_results"
# .env file should be in the same folder as this script
# path below is relative to the package where this script
# gets executed by yarn
ENV_FILE = "./test/integrations/.env"

CONNECTION_FAILED_ERROR = "runner configured, but connection failed"

config = {**dotenv_values(ENV_FILE)}


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return json.JSONEncoder.default(self, obj)


class sqlRunner(ABC):
    def __init__(self):
        self.open_connection()

    @abstractmethod
    def open_connection(self):
        pass

    def get_query_result(self, sql: str) -> dict:
        starttime = time.time()
        rows_dict = self.run_query(sql)
        return {
            "walltime_seconds": time.time() - starttime,
            "rows": rows_dict,
        }

    @abstractmethod
    def run_query(self, sql: str) -> list[dict]:
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

    def run_query(self, sql: str) -> list[dict]:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            return cursor.fetchall()


class postgresRunner(sqlRunner):
    def open_connection(self):
        self.connection = psycopg2.connect(
            host=config["POSTGRES_TEST_HOST"],
            user=config["POSTGRES_TEST_USER"],
            dbname=config["POSTGRES_TEST_DATABASE"],
        )
        self.cursor_kwargs = {"cursor_factory": psycopg2.extras.RealDictCursor}

    def run_query(self, sql: str) -> list[dict]:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            res = []
            for row in cursor.fetchall():
                res.append(dict(row))
            return res


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

    def run_query(self, sql: str) -> list[dict]:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            res = cursor.execute(sql).fetchall()
            # lower case col names
            return [{k.lower(): v for k, v in row.items()} for row in res]


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

    def run_query(self, sql: str) -> list:
        cursor = self.connection.cursor(**self.cursor_kwargs)
        cursor.execute(sql)
        rows = cursor.fetchall()
        colnames = [col[0] for col in cursor.description]
        res = [dict(zip(colnames, row)) for row in rows]
        return res


class databricksRunner(sqlRunner):
    def open_connection(self):
        self.connection = databricks_sql.connect(
            server_hostname=config["DATABRICKS_TEST_HOST"],
            http_path=config["DATABRICKS_TEST_PATH"],
            access_token=config["DATABRICKS_TEST_TOKEN"],
        )

    def run_query(self, sql: str) -> list:
        cursor = self.connection.cursor()
        cursor.execute(sql)
        rows = cursor.fetchall()
        return [row.asDict() for row in rows]


class bigqueryRunner(sqlRunner):
    def open_connection(self):
        self.connection = bigquery.Client(
            credentials=service_account.Credentials.from_service_account_file(
                config["GOOGLE_APPLICATION_CREDENTIALS"]
            )
        )

    def run_query(self, sql: str) -> list:
        query_job = self.connection.query(query=sql)
        res = query_job.result()
        return [dict(row) for row in res]


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
        elif engine == "databricks":
            return databricksRunner()
        else:
            return dummyRunner("no runner configured")
    except Exception as e:
        print(e)
        print(f"failure connection to {engine} engine")
        return dummyRunner(CONNECTION_FAILED_ERROR)


def execute_query(sql, engine) -> dict:
    runner = get_sql_runner(engine)
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

        if engine not in runners:
            runners[engine] = get_sql_runner(engine)

        key = engine + "::" + test_case["sql"]
        if key in cache:
            results.append(cache[key])
        else:
            if engine not in nonlinted_engines:
                validate(test_case)
            result = execute_query(test_case["sql"], engine)
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
