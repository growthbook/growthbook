from dataclasses import asdict
import json
import time
import sys
import traceback
from gbstats.gbstats import process_multiple_experiment_results

for line in sys.stdin:
    start = time.time()

    # Read from stdin and parse JSON
    try:
        input = json.loads(line, strict=False)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON input: {str(e)}\n")
        sys.stderr.flush()
        continue
    except Exception as e:
        sys.stderr.write(f"Unexpected error parsing input: {str(e)}\n")
        sys.stderr.flush()
        continue

    # Extract required fields
    # Two formats are supported:
    # 1. Single experiment: { id: "exp-id", data: { metrics, analyses, query_results, bandit_settings? } }
    # 2. Batch format: { id: "tracking-id", data: [experiment1, experiment2, ...] }
    #    where each experiment has: { id: "exp-id", data: { metrics, analyses, query_results, bandit_settings? } }
    try:
        tracking_id = input["id"]
        data = input["data"]

        # Detect format: if data is a list, it's batch format; if dict, it's single experiment
        if isinstance(data, list):
            # Batch format: data is a list of experiments
            experiments = data
        else:
            # Single experiment format: wrap in list for process_multiple_experiment_results
            experiments = [input]

        # Python's process_data_dict has a bug where it checks if "bandit_settings" key exists
        # but doesn't check if the value is None before trying to unpack it.
        # Remove the key if it's None to work around this for each experiment.
        for exp in experiments:
            if "data" in exp and isinstance(exp["data"], dict):
                if "bandit_settings" in exp["data"] and exp["data"]["bandit_settings"] is None:
                    del exp["data"]["bandit_settings"]
    except KeyError as e:
        sys.stderr.write(f"Missing required field: {str(e)}\n")
        sys.stderr.flush()
        continue
    except TypeError as e:
        sys.stderr.write(f"Input is not a valid object: {str(e)}\n")
        sys.stderr.flush()
        continue
    except Exception as e:
        sys.stderr.write(f"Error extracting fields from input: {str(e)}\n")
        sys.stderr.flush()
        continue

    # Process experiment results
    # process_multiple_experiment_results expects a list of {id, data} objects
    try:
        analyses = process_multiple_experiment_results(experiments)

        # For single experiment format, return the first result directly
        # For batch format, return all results
        if isinstance(data, list):
            # Batch format: return list of results
            results = [asdict(analysis) for analysis in analyses]
            sys.stdout.write(json.dumps({
                'id': tracking_id,
                'results': results,
                'time': time.time() - start
            }, allow_nan=True) + "\n")
        else:
            # Single experiment format: return the first result's fields directly
            analysis = asdict(analyses[0])
            sys.stdout.write(json.dumps({
                'id': analysis['id'],
                'results': analysis['results'],
                'banditResult': analysis.get('banditResult'),
                'error': analysis.get('error'),
                'traceback': analysis.get('traceback'),
                'time': time.time() - start
            }, allow_nan=True) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({
            'id': tracking_id,
            'error': str(e),
            # Include formatted stack trace
            'stack_trace': traceback.format_exc(),
            'time': time.time() - start
        }, allow_nan=True) + "\n")
        sys.stdout.flush()
