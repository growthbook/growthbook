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
    try:
        id = input["id"]
        data = input["data"]
        # Python's process_data_dict has a bug where it checks if "bandit_settings" key exists
        # but doesn't check if the value is None before trying to unpack it.
        # Remove the key if it's None to work around this.
        if "bandit_settings" in data and data["bandit_settings"] is None:
            del data["bandit_settings"]
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
    # Since we pass one experiment, we get one MultipleExperimentMetricAnalysis back
    try:
        analyses = process_multiple_experiment_results([input])
        # Return the first (and only) analysis result directly
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
            'id': id,
            'error': str(e),
            # Include formatted stack trace
            'stack_trace': traceback.format_exc(),
            'time': time.time() - start
        }, allow_nan=True) + "\n")
        sys.stdout.flush()
