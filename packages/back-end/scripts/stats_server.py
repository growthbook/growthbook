from dataclasses import asdict
import json
import time
import sys
import traceback
from gbstats.gbstats import (
    process_multiple_experiment_results,
    process_contextual_bandit_results,
)

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

    # Optional discriminator. Default keeps the historical behavior of
    # multi-experiment metric analysis. New `contextual_bandit` kind dispatches
    # into the contextual bandit pipeline (gbstats.process_contextual_bandit_results).
    kind = (input.get("kind") if isinstance(input, dict) else None) or "experiments"

    try:
        if kind == "contextual_bandit":
            results = asdict(process_contextual_bandit_results(data))
        else:
            results = [asdict(analysis) for analysis in process_multiple_experiment_results(data)]
        sys.stdout.write(json.dumps({
            'id': id,
            'results': results,
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
