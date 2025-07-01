from dataclasses import asdict
import json
import time
import sys
from gbstats.gbstats import process_multiple_experiment_results

for line in sys.stdin:
    start = time.time()

    # Read from stdin
    input = json.loads(line, strict=False)

    id = input["id"]

    # cast asdict because dataclasses are not serializable
    results = [asdict(analysis) for analysis in process_multiple_experiment_results(input["data"])]
    try:
        sys.stdout.write(json.dumps({
            'id': id,
            'results': results,
            'time': time.time() - start
        }, allow_nan=False) + "\n")
    except Exception as e:
        sys.stdout.write(json.dumps({
            'id': id,
            'error': str(e),
            'time': time.time() - start
        }, allow_nan=False) + "\n")

    sys.stdout.flush()