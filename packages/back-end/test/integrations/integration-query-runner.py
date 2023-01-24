from abc import ABC, abstractmethod
import json
from decimal import Decimal
import os
import sys
from pprint import pprint

from google.cloud import bigquery
import prestodb
import mysql.connector
import psycopg2
import psycopg2.extras
import sqlfluff
import snowflake.connector



class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return json.JSONEncoder.default(self, obj)

class sqlRunner(ABC):
    def __init__(self):
        self.open_connection()

    @abstractmethod
    class open_connection():
        pass

    def close_connection(self):
        self.connection.close()

class mysqlRunner(sqlRunner):
    def open_connection(self):
        self.connection = mysql.connector.connect(
            host=os.getenv('MYSQL_TEST_HOST', ''),
            user=os.getenv('MYSQL_TEST_USER', ''),
            database=os.getenv('MYSQL_TEST_DATABASE', ''),
            password=os.getenv('MYSQL_TEST_PASSWORD', '')
        )
        self.cursor_kwargs = {'dictionary': True, 'buffered': True}

    def run_query(self,  sql: str) -> list:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            return cursor.fetchall()

class postgresRunner(sqlRunner):
    def open_connection(self):
        self.connection = psycopg2.connect(
            host=os.getenv('POSTGRES_TEST_HOST', ''),
            user=os.getenv('POSTGRES_TEST_USER', ''),
            dbname=os.getenv('POSTGRES_TEST_DATABASE', ''),
        )
        self.cursor_kwargs = {"cursor_factory": psycopg2.extras.RealDictCursor}
    
    def run_query(self,  sql: str) -> list:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            cursor.execute(sql)
            res = []
            for row in cursor.fetchall():
                res.append(dict(row))
            return res

class snowflakeRunner(sqlRunner):
    def open_connection(self):
        self.connection = snowflake.connector.connect(
            user=os.getenv('SNOWFLAKE_TEST_USER', ''),
            password=os.getenv('SNOWFLAKE_TEST_PASSWORD', ''),
            account=os.getenv('SNOWFLAKE_TEST_ACCOUNT', ''),
            database=os.getenv('SNOWFLAKE_TEST_DATABASE', ''),
            schema=os.getenv('SNOWFLAKE_TEST_SCHEMA', '')
        )
        self.cursor_kwargs = {'cursor_class': snowflake.connector.DictCursor}

    def run_query(self,  sql: str) -> list:
        with self.connection.cursor(**self.cursor_kwargs) as cursor:
            res = cursor.execute(sql).fetchall()
            # lower case col names
            return [{k.lower(): v for k, v in row.items()} for row in res]

class prestoRunner(sqlRunner):
    def open_connection(self):
        self.connection = prestodb.dbapi.connect(
            host='localhost',
            port=8080,
            user='myuser',
            catalog='mysql',
            schema='sample',
        )
        self.cursor_kwargs = {}
    
    def run_query(self,  sql: str) -> list:
        cursor = self.connection.cursor(**self.cursor_kwargs)
        cursor.execute(sql)
        rows = cursor.fetchall()
        colnames = [col[0] for col in cursor.description]
        res = [dict(zip(colnames, row)) for row in rows]
        return res

class bigqueryRunner(sqlRunner):
    def open_connection(self):
        self.connection = bigquery.Client()
    
    def run_query(self, sql: str) -> list:
        query_job = self.connection.query(query=sql)
        res = query_job.result()
        return [dict(row) for row in res]

def read_queries_json() -> dict:
    with open('/tmp/json/queries.json') as f:
        data = json.load(f)
    return data

def print_sql(txt, insert_line_numbers=False):
    if insert_line_numbers:
        sql_string = "\n".join([f"{n+1:03d} {line}" for n, line in enumerate(txt.split("\n"))])
    else:
        sql_string = "\n".join([f"{line}" for n, line in enumerate(txt.split("\n"))])
    print(sql_string)

def read_queries_cache() -> dict:
    try:
        with open("/tmp/cache.json", "r") as f:
            return json.load(f)
    except:
        print("Failed to load query cache, creating a new one...")
        return {}

def write_cache(cache):
    cache_string = json.dumps(cache, cls=DecimalEncoder)
    with open("/tmp/cache.json", "w") as outfile:
        outfile.write(cache_string)

def get_sql_runner(engine) -> sqlRunner:
    if engine == 'mysql':
        return mysqlRunner()
    elif engine == 'postgres':
        return postgresRunner()
    elif engine == 'bigquery':
        return bigqueryRunner()
    elif engine == 'snowflake':
        return snowflakeRunner()
    elif engine == 'presto':
        return prestoRunner()
    else:
        raise ValueError()

def execute_query(sql, engine) -> list[dict]:
    runner = get_sql_runner(engine)
    return runner.run_query(sql)


def validate(test_case):
    dialect = 'ansi' if test_case['engine'] == 'presto' else test_case['engine']
    errors = sqlfluff.lint(
        test_case['sql'], 
        dialect=dialect,
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
            "L027", # allows potentially ambiguous column references
            "L028",
            "L029", # Keywords should not be used as identifiers. Ignored bc timestamp is used as col
            "L030",
            "L031",
            "L034",
            "L051", # allows JOIN instead of INNER JOIN
            "L063",
            "L064", # allows " instead of ' around dates
            "L067",

        ]
    )
    if len(errors) > 0:
        print(test_case["name"])
        print(test_case["engine"])
        print(print_sql(test_case["sql"], insert_line_numbers=True))
        for error in errors:
            print(error)
        raise ValueError("sqlfluff error")

# TODO: add local option to just use local DBs instead for faster/cheaper testing
def main():
    test_cases = read_queries_json()
    
    cache = read_queries_cache()
    results = []
    runners = {}
    
    for test_case in test_cases:
        engine = test_case["engine"]

        if engine not in ['mysql', 'postgres', 'bigquery', 'snowflake', 'presto']:
            continue
        if engine not in runners:
            runners[engine] = get_sql_runner(engine)
        
        key = engine + '::' + test_case['sql']
        if key in cache:
            results.append(cache[key])
        else:
            if engine != 'presto':
                validate(test_case)
            if engine in runners:
                test_case["rows"] = execute_query(test_case["sql"], engine)
            else:
                test_case["rows"] = [{'missing_reason': 'not executed, only linted'}]
            # TODO also save sql somewhere else?
            result = {k: v for k, v in test_case.items() if k != 'sql'}
            cache[key] = result
            write_cache(cache)
            results.append(result)

    for engine, runner in runners.items():
        runner.close_connection()
    
    # Learn what branch and write out results
    branch_name = sys.argv[1].replace("/", "") if len(sys.argv) > 1 else ''
    res_filename = f'/tmp/json/query_results_{branch_name}.json'
    print(f"Writing query result json to {res_filename}...")
    with open(res_filename, 'w') as f:
        f.write(json.dumps(results, cls=DecimalEncoder, indent=2))
    return results

if __name__ == "__main__":
    main()