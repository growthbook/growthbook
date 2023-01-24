ts-node --swc ./test/integrations/integration-query-generator.ts
gitbranch="$(git branch --no-color --show-current)"
python3 ./test/integrations/integration-query-runner.py $gitbranch
