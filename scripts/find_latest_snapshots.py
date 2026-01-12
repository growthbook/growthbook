#!/usr/bin/env python3
"""
Script to find the latest successful snapshots for each experiment by type.

For each experiment, finds:
1. The latest snapshot with type="standard" and status="success"
2. The latest snapshot with type="report" and status="success" for each report
3. The latest snapshot with type="exploratory" and status="success" for each dimension
"""

import os
from pymongo import MongoClient
from datetime import datetime


def get_mongo_client():
    """Create MongoDB client from environment variable or default."""
    mongo_uri = os.environ.get("MONGO_URL", "mongodb://localhost:27017/growthbook")
    return MongoClient(mongo_uri)


def find_all_latest_snapshots(collection):
    """
    Find all latest snapshots in a single aggregation using $facet.
    
    Returns a dict with keys:
    - 'standard': latest type=standard, status=success for each experiment
    - 'report': latest type=report, status=success for each experiment+report combo
    - 'exploratory': latest type=exploratory, status=success for each experiment+dimension combo
    """
    pipeline = [
        # First filter to only successful snapshots
        {
            "$match": {
                "status": "success",
                "type": {"$in": ["standard", "report", "exploratory"]},
            }
        },
        # Sort by dateCreated descending (latest first)
        {"$sort": {"dateCreated": -1}},
        # Use $facet to run three parallel aggregations
        {
            "$facet": {
                # Latest standard snapshot per experiment
                "standard": [
                    {"$match": {"type": "standard"}},
                    {
                        "$group": {
                            "_id": "$experiment",
                            "latestSnapshot": {"$first": "$$ROOT"},
                        }
                    },
                    {"$replaceRoot": {"newRoot": "$latestSnapshot"}},
                ],
                # Latest report snapshot per experiment + report combo
                "report": [
                    {"$match": {"type": "report"}},
                    {
                        "$group": {
                            "_id": {
                                "experiment": "$experiment",
                                "report": "$report",
                            },
                            "latestSnapshot": {"$first": "$$ROOT"},
                        }
                    },
                    {"$replaceRoot": {"newRoot": "$latestSnapshot"}},
                ],
                # Latest exploratory snapshot per experiment + dimension combo
                "exploratory": [
                    {"$match": {"type": "exploratory"}},
                    {
                        "$group": {
                            "_id": {
                                "experiment": "$experiment",
                                "dimension": "$dimension",
                            },
                            "latestSnapshot": {"$first": "$$ROOT"},
                        }
                    },
                    {"$replaceRoot": {"newRoot": "$latestSnapshot"}},
                ],
            }
        },
    ]
    
    results = list(collection.aggregate(pipeline))
    # $facet returns a single document with the facet results
    return results[0] if results else {"standard": [], "report": [], "exploratory": []}


def format_date(dt):
    """Format datetime for display."""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)


def main():
    print("Connecting to MongoDB...")
    client = get_mongo_client()
    
    # Get the database name from the connection string or use default
    default_db = client.get_default_database()
    db_name = default_db.name if default_db is not None else "growthbook"
    db = client[db_name]
    collection = db["experimentsnapshots"]
    
    print(f"Connected to database: {db_name}")
    print("Collection: experimentsnapshots")
    print("=" * 80)
    
    # Find all latest snapshots in one aggregation
    results = find_all_latest_snapshots(collection)
    
    standard_snapshots = results["standard"]
    report_snapshots = results["report"]
    exploratory_snapshots = results["exploratory"]
    
    # 1. Display standard snapshots
    print("\n📊 LATEST STANDARD SNAPSHOTS (type=standard, status=success)")
    print("-" * 80)
    print(f"Found {len(standard_snapshots)} experiments with standard snapshots\n")
    
    # 2. Display report snapshots
    print("\n📄 LATEST REPORT SNAPSHOTS (type=report, status=success)")
    print("-" * 80)
    print(f"Found {len(report_snapshots)} experiment-report combinations\n")
    
    # 3. Display exploratory snapshots
    print("\n🔍 LATEST EXPLORATORY SNAPSHOTS (type=exploratory, status=success)")
    print("-" * 80)
    print(f"Found {len(exploratory_snapshots)} experiment-dimension combinations\n")
    
    # Summary
    print("=" * 80)
    print("SUMMARY")
    print(f"  Standard snapshots: {len(standard_snapshots)}")
    print(f"  Report snapshots: {len(report_snapshots)}")
    print(f"  Exploratory snapshots: {len(exploratory_snapshots)}")
    print(f"  Total: {len(standard_snapshots) + len(report_snapshots) + len(exploratory_snapshots)}")
    
    client.close()
    
    # Return all results for programmatic use
    return results


if __name__ == "__main__":
    main()
