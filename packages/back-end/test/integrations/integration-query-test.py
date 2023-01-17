from abc import ABC, abstractmethod
import json
from decimal import Decimal
from pprint import pprint
import os

import sqlfluff
import mysql.connector
import psycopg2


import os



class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return json.JSONEncoder.default(self, obj)

class sqlRunner(ABC):
    def __init__(self):
        self.open_connection()

    @abstractmethod
    class run_query():
        pass

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
    

    def run_query(self,  sql: str) -> list:
        with self.connection.cursor(dictionary=True, buffered=True) as cursor:
            print("Executing...")
            cursor.execute(sql)
            return cursor.fetchall()

class postgresRunner(sqlRunner):
    def open_connection(self):
        self.connection = psycopg2.connector.connect(
            host=os.getenv('POSTGRES_TEST_HOST', ''),
            user=os.getenv('POSTGRES_TEST_USER', ''),
            database=os.getenv('POSTGRES_TEST_DATABASE', ''),
            password=os.getenv('POSTGRES_L_TEST_PASSWORD', '')
        )
    

    def run_query(self,  sql: str) -> list:
        with self.connection.cursor(dictionary=True, buffered=True) as cursor:
            print("Executing...")
            cursor.execute(sql)
            return cursor.fetchall()


# Connect to your postgres DB
conn = psycopg2.connect("dbname=test user=postgres")

# Open a cursor to perform database operations
cur = conn.cursor()

# Execute a query
cur.execute("SELECT * FROM my_data")

# Retrieve query results
records = cur.fetchall()

def read_queries_json() -> dict:
    with open('/tmp/json/queries.json') as f:
        data = json.load(f)
    return data

def insert_line_numbers(txt):
    return "\n".join([f"{n+1:03d} {line}" for n, line in enumerate(txt.split("\n"))])

def read_queries_cache() -> dict:
    try:
        with open("/tmp/cache.json", "r") as f:
            return json.load(f)
    except:
        print("FAILED TO LOAD")
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
    else:
        raise ValueError()

def execute_query(sql, engine) -> str:
    runner = get_sql_runner(engine)
    return runner.run_query(sql)


def validate(test_case):
    errors = sqlfluff.lint(
        test_case['sql'], 
        dialect=test_case['engine'],
        exclude_rules=[
            "L003",
            "L006",
            "L009",
            "L010",
            "L011",
            "L014",
            "L016",
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
        print(insert_line_numbers(test_case["sql"]))
        for error in errors:
            print(error)
        raise ValueError("sqlfluff error")

# TODO: add local option to just use local DBs instead for faster/cheaper testing
def main():
    test_cases = read_queries_json()
    
    cache = read_queries_cache()
    result = []
    runners = {}
    
    for test_case in test_cases:
        engine = test_case["engine"]
        if engine != "mysql":
            continue
        if engine not in runners:
            runners[engine] = get_sql_runner(engine)

        runner = runners[engine]
        print("====")
        print(test_case["name"])
        key = engine + '::' + test_case['sql']
        if key in cache:
            print("FOUND IN CACHE")
            print(cache[key]["sql"])
            result.append(cache[key])
        else:
            validate(test_case)
            test_case["rows"] = execute_query(test_case["sql"], engine)
            cache[key] = test_case
            write_cache(cache)
            result.append(test_case)

        print("====")

    for engine, runner in runners.items():
        runner.close_connection()
    
    # TODO: output result in a format that's easy to diff
    print(result)

if __name__ == "__main__":
    main()