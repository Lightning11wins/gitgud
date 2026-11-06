#!/usr/bin/env bash
# Seeds issues, PRs, comments, and reviews into the sandbox repo for manual testing.
# Expects branches big-refactor, small-fix, draft-work to exist.
set -u
R=Lightning11wins/gitgud-sandbox
api() { gh api "$@" 2>&1; }
pause() { sleep 1.2; }

api repos/$R/labels/test-perm -X DELETE >/dev/null
for l in "bug:d73a4a:Something isn't working" "enhancement:a2eeef:New feature or request" "documentation:0075ca:Docs" "good first issue:7057ff:Good for newcomers" "priority: high:b60205:Urgent" "needs triage:fbca04:Not yet triaged" "wontfix:ffffff:Will not be worked on"; do
  IFS=: read -r name color desc <<<"$l"
  api repos/$R/labels -f name="$name" -f color="$color" -f description="$desc" >/dev/null
done
api repos/$R/milestones -f title="v1.0" -f description="First release" -f due_on="2026-12-31T00:00:00Z" >/dev/null
api repos/$R/milestones -f title="v2.0" >/dev/null
api repos/$R/issues/1 -X PATCH -f title="Inventory totals are wrong for empty carts" -f body="When the cart is empty, \`computeTotal0\` returns \`NaN\` in some cases.

### Steps
1. Open an empty cart
2. Check the total

- [x] Reproduced locally
- [ ] Wrote a failing test" -f milestone=1 >/dev/null
api repos/$R/issues/1/labels -f "labels[]=bug" -f "labels[]=priority: high" >/dev/null
api repos/$R/issues/1/assignees -f "assignees[]=Lightning11wins" >/dev/null

titles=("Add CSV export to reports" "Server crashes on /h5 with long paths" "Document the inventory API" "Support dark mode in the report viewer" "Flaky test in reports_test.py" "Rename computeTotal helpers" "Add rate limiting to the server" "Typo in guide section 7" "Improve error messages" "Investigate memory growth" "Migrate config to TOML" "Add pagination to item listing")
labels=("enhancement" "bug" "documentation" "enhancement" "bug" "good first issue" "enhancement" "documentation" "needs triage" "bug" "enhancement" "enhancement")
for i in "${!titles[@]}"; do
  n=$(api repos/$R/issues -f title="${titles[$i]}" -f body="Details for **${titles[$i]}**.

\`\`\`ts
const example = computeTotal$i([]);
\`\`\`" -f "labels[]=${labels[$i]}" -q .number)
  pause
  case $i in
    2|7) api repos/$R/issues/$n -X PATCH -f state=closed -f state_reason=completed >/dev/null ;;
    9) api repos/$R/issues/$n -X PATCH -f state=closed -f state_reason=not_planned >/dev/null ;;
  esac
done

# Issue with a long conversation.
LONG=$(api repos/$R/issues -f title="Discussion: long thread for performance testing" -f body="This issue has many comments to test rendering." -q .number)
for c in $(seq 1 120); do
  api repos/$R/issues/$LONG/comments -f body="Comment $c. Lorem ipsum dolor sit amet, **consectetur** adipiscing elit. \`code $c\` and a [link](https://example.com/$c).$( [ $((c % 10)) -eq 0 ] && printf '\n\n```py\nprint(%d)\n```' $c)" >/dev/null
  pause
done

# PRs.
BIG=$(api repos/$R/pulls -f title="Refactor inventory and reports" -f head=big-refactor -f base=main -f body="## Summary

Large refactor touching many files, for testing the Files tab.

## Testing

- [x] Unit tests
- [ ] Manual test" -q .number)
SMALL=$(api repos/$R/pulls -f title="Clarify guide section 3" -f head=small-fix -f base=main -f body="Small docs fix." -q .number)
DRAFT=$(api repos/$R/pulls -f title="WIP: draft work" -f head=draft-work -f base=main -f draft=true -f body="Not ready yet." -q .number)
api repos/$R/issues/$BIG/labels -f "labels[]=enhancement" >/dev/null
for c in $(seq 1 40); do
  api repos/$R/issues/$BIG/comments -f body="PR conversation comment $c." >/dev/null
  pause
done

# A submitted review with inline threads on the big PR.
HEAD=$(api repos/$R/pulls/$BIG -q .head.sha)
cat > "${TMPDIR:-/tmp}/review.json" <<JSON
{"commit_id":"$HEAD","event":"COMMENT","body":"A few notes on the refactor.","comments":[
 {"path":"src/inventory.ts","line":10,"side":"RIGHT","body":"Why a running sum comment here?"},
 {"path":"src/reports.py","line":12,"side":"RIGHT","body":"Consider using a module-level logger name constant."},
 {"path":"src/reports.py","start_line":14,"line":16,"side":"RIGHT","body":"Multi-line comment over this block."},
 {"path":"src/generated/module_05.ts","line":3,"side":"RIGHT","body":"\`\`\`suggestion\nexport const value5_2 = 10; // fixed constant\n\`\`\`"}
]}
JSON
api repos/$R/pulls/$BIG/reviews --input "${TMPDIR:-/tmp}/review.json" >/dev/null
CID=$(api "repos/$R/pulls/$BIG/comments?per_page=1" -q '.[0].id')
api repos/$R/pulls/$BIG/comments/$CID/replies -f body="Good question, it's for readability." >/dev/null
echo "seeded: long issue #$LONG, big PR #$BIG, small PR #$SMALL, draft PR #$DRAFT"
