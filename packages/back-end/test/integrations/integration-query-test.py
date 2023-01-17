from abc import ABC, abstractmethod
import json
from decimal import Decimal
from pprint import pprint
import os

import sqlfluff
import mysql.connector

with open(os.path.expanduser('~/db_credentials.json')) as f:
    PASSWORDS = json.load(f)

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return str(obj)
        return json.JSONEncoder.default(self, obj)

class sqlRunner(ABC):
    @abstractmethod
    class run_query():
        pass

class mysqlRunner(sqlRunner):

    def run_query(self, sql: str) -> list:
        with mysql.connector.connect(
            host="localhost",
            user="root",
            password=PASSWORDS["MYSQL_PASSWORD"],
            database="sample"
        ) as connection:
            with connection.cursor(dictionary=True) as cursor:
                print("Executing...")

                cursor.execute(sql)
                return cursor.fetchall()

class postgresRunner(sqlRunner):
    def run_query(self, sql: str) -> str:
        raise NotImplementedError()

def read_queries_json() -> dict:
    with open('/tmp/json/queries.json') as f:
        data = json.load(f)
    return data

def insert_line_numbers(txt):
    return "\n".join([f"{n+1:03d} {line}" for n, line in enumerate(txt.split("\n"))])

def read_queries_cache() -> dict:
    return {}
    # try:
    #     with open("/tmp/cache.json", "r") as f:
    #         return json.load(f)
    # except:
    #     print("FAILED TO LOAD")
    #     return {}

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
    
    for test_case in test_cases:
        
        print("====")
        print(test_case["name"])
        key = test_case['engine'] + '::' + test_case['sql']
        if key in cache:
            print("FOUND IN CACHE")
            print(cache[key]["sql"])
            result.append(cache[key])
        else:
            if test_case["engine"] != "mysql":
                continue
            validate(test_case)
            test_case["rows"] = execute_query(test_case["sql"], test_case["engine"])
            cache[key] = test_case
            write_cache(cache)
            result.append(test_case)

        print("====")
    
    # TODO: output result in a format that's easy to diff
    print(result)

if __name__ == "__main__":
    main()