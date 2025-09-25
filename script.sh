#!/bin/bash
# Get the list of changed files
if [ true == true ]; then
    echo "PR"
    # For pull requests, compare against the base branch
    BASE_REF="5d9a93dfb61f06d7c35069591fdf8714e885d2e8"
    HEAD_REF="2d134bfdc4f48efac826f78e401fe5649bed4f29"
    CHANGED_FILES=$(git diff --name-only $BASE_REF $HEAD_REF)
else
    echo "PUSH"
    # For push events check all files but don't fail CI
    CHANGED_FILES="."
fi

echo $CHANGED_FILES

if [ false == true ]; then
    echo "PUSH"
    if ! yarn prettier --check $CHANGED_FILES; then
        echo "::warning::Prettier formatting issues found in modified files. Consider running 'yarn pretty' to fix:"
        echo "$CHANGED_FILES"
    fi
else
    echo "PR"
    echo "Checking Prettier format for modified files..."
    yarn prettier --check $CHANGED_FILES
fi