<!-- devloop: 0.166.0 -->
# Issue tracker

Issues live in GitHub Issues of `jayjay-create/devloop-test-aa`.

## Labels

- `needs-triage` — new
- `needs-info` — waiting on an answer
- `being-planned` — a spec is being written into it right now; nobody acts on it, not an agent and not a human
- `ready-for-agent` — a standalone issue a human has judged buildable as written; never on a task under a spec, where readiness is the blocker query instead
- `needs-human` — needs a human decision
- `wont-do` — declined, with a reason
- `raised-here` — this workflow raised it against work in this project, rather than somebody filing it from outside

## Ordering work

Tasks are sub-issues of their spec. Dependencies are real, queryable
relationships — never prose in the body.

Get an issue's node ID:

    gh api graphql -f query='{repository(owner:"jayjay-create",name:"devloop-test-aa"){issue(number:N){id}}}' -q '.data.repository.issue.id'

Attach a task to its spec:

    gh api graphql -f query='mutation{addSubIssue(input:{issueId:"PARENT_ID",subIssueId:"CHILD_ID"}){issue{number}}}'

Record that one task waits for another:

    gh api graphql -f query='mutation{addBlockedBy(input:{issueId:"WAITING_ID",blockingIssueId:"MUST_FINISH_FIRST_ID"}){issue{number}}}'

Ask which task is ready — open, zero open blockers, and no open pull
request already building it:

    gh api graphql -f query='{repository(owner:"jayjay-create",name:"devloop-test-aa"){issue(number:SPEC){subIssues(first:20){nodes{number title state blockedBy(first:10){nodes{number state}} closedByPullRequestsReferences(first:10){nodes{number state}}}}}}}' -q '.data.repository.issue.subIssues.nodes[] | select(.state=="OPEN") | "\(.number) \(.title) | open blockers: \([.blockedBy.nodes[] | select(.state=="OPEN")] | length) | open pull requests: \([.closedByPullRequestsReferences.nodes[] | select(.state=="OPEN")] | length)"'

Ask what is in flight — every open issue **and** every open pull request,
in one command. Two commands would be two things to remember, and the
second is the one that gets forgotten:

    gh api graphql -f query='{repository(owner:"jayjay-create",name:"devloop-test-aa"){issues(states:OPEN,first:50){totalCount nodes{number title parent{number} subIssues(first:50){totalCount nodes{state}} labels(first:10){nodes{name}}}} pullRequests(states:OPEN,first:50){totalCount nodes{number title isDraft viewerDidAuthor author{login} closingIssuesReferences(first:10){nodes{number state}}}}}}' -q '"open: \(.data.repository.issues.totalCount) issues, \(.data.repository.pullRequests.totalCount) pull requests (50 of each shown)", (.data.repository.issues.nodes[] | "issue \(.number) | parent: \(.parent.number // "-") | tasks open/total: \([.subIssues.nodes[] | select(.state=="OPEN")] | length)/\(.subIssues.totalCount) | labels: \([.labels.nodes[].name] | join(",")) | \(.title)"), (.data.repository.pullRequests.nodes[] | "pull request \(.number) | draft: \(.isDraft) | mine: \(.viewerDidAuthor) | by: \(.author.login) | closes: \(if (.closingIssuesReferences.nodes|length)==0 then "-" else ([.closingIssuesReferences.nodes[] | "\(.number) \(.state)"] | join("; ")) end) | \(.title)")'

A spec is an open issue with children. An unfinished planning carries
`being-planned`. A loose issue has neither. **An open pull request is work
that is built and has not landed** — the ordinary way a session ends, not an
exception, because a build opens the pull request and then either arms the
platform or hands the merge over, and nothing moves until the user says it
has landed.

What those two return, beside what each value is read for:

- `issues` returns issues and never pull requests. Its nodes are of type
  `Issue`, and `PullRequest` is a different type, so no filter and no state
  makes a pull request appear there.
- `states:OPEN` on `pullRequests` is read for "not landed yet". **A draft is
  inside it**: a draft's own `state` reads `OPEN`. Draft is a separate field,
  not a state.
- `viewerDidAuthor` says whether the account this runs as opened the pull
  request, which is what "is this ours" asks. It does not say whether the
  branch sits on a fork — that is `isCrossRepository`.
- `closingIssuesReferences` says which issues this pull request would close
  on merging, each with its own `state`, and it is read for "which work is
  this". It is filled from a closing keyword in the body or the commits and
  is empty without one. Empty means the pull request names no work, not that
  it has none — and a branch name is not this field.
- `closedByPullRequestsReferences` is the same relationship read from the
  issue, and it is read for "is this task already built". Its
  `includeClosedPrs` argument defaults to false, which does **not** mean only
  open ones come back: merged pull requests are returned too. Filter on each
  node's own `state`; never on the argument name.

Ask which `raised-here` issues carry a given line of `standards.md`. The
close of a review asks this of every rule there before it takes one out,
and a rule any issue cites stays; the line goes in verbatim, as it stands
in the file:

    gh issue list --label raised-here --state all --limit 500 --json number,body -q 'map(select(.body | contains("THE LINE")) | .number)'

The mutation is `addBlockedBy` with the fields `issueId` and `blockingIssueId`.
There is no `addIssueBlockedBy`; guessing that name fails.
