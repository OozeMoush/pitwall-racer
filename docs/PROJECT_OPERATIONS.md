# Pitwall Racer — Project Operations

## Purpose

Pitwall Racer is large enough that chat history or model memory must not be used as the project database.

The operating rule is:

> **If information must survive the end of a chat, it belongs in GitHub.**

ChatGPT Project provides workspace continuity. Work provides execution capacity. Neither replaces the repository as the durable source of truth.

## Information ownership

Avoid duplicating the same fact in several documents. Each artifact has one job.

| Artifact | Owns | Does not own |
| --- | --- | --- |
| `README.md` | onboarding, run/verify commands, repository workflow, high-level architecture | detailed current state or long design rationale |
| `DESIGN.md` | durable product decisions, design principles, milestone intent | task status |
| `docs/PROJECT_STATE.md` | concise current baseline, current playable shape, recent structural decisions, current risks | full history |
| `PLAYTEST.md` | gameplay verification and human/automated playtest gates | work queue |
| GitHub Issue | a problem/goal, acceptance criteria, durable resume point | implementation diff |
| Pull Request | one mergeable implementation unit and its verification evidence | long-term project state |
| code/tests | implementation truth and executable invariants | product rationale |
| ChatGPT Project instructions | how ChatGPT should use the repository | duplicate project facts |
| ChatGPT memory/chat history | convenience and conversational continuity | authoritative project state |

## Repository-first workflow

### Before substantial work

1. Sync/read current `main`.
2. Read:
   - `README.md`
   - `docs/PROJECT_STATE.md`
   - `docs/PROJECT_OPERATIONS.md`
3. Read the relevant Issue and any linked/open PR.
4. For gameplay work, also read `PLAYTEST.md`.
5. If there is no Issue for substantial multi-step work, create one before implementation.
6. Create a short-lived branch from current `main`.

Do not start from an old feature branch unless the explicit goal is archival recovery. Recreate active work from current main.

### During work

- Keep the Issue as the durable task/resume record.
- Split a large Issue across multiple PRs when each PR is coherent, independently mergeable and moves the Issue toward its acceptance criteria.
- Small Issues should normally stay one PR.
- Link every implementation PR to its Issue.
- Put material design decisions in `DESIGN.md`, not only in PR discussion.
- Put permanent process rules in this document; put gameplay verification invariants in `PLAYTEST.md`.
- Do not update `PROJECT_STATE.md` for every small commit; update it when the project baseline or direction materially changes.

### Before ending a Work/chat implementation session

Leave GitHub in a state that another session can resume without this conversation.

At minimum, one of these must exist:

- a merged PR; or
- an open PR with current CI status; or
- an Issue comment containing a checkpoint.

A checkpoint should state:

- what was completed;
- branch / PR;
- verification already run;
- remaining work;
- blockers or unresolved decisions;
- next recommended action.

If a durable product/architecture decision changed, update `DESIGN.md`.
If the overall project baseline changed materially, update `docs/PROJECT_STATE.md`.

## Issue and PR policy

### Issues are goals

An Issue describes the durable outcome and acceptance criteria.

One Issue **may** be completed by multiple PRs. This is preferred over a giant PR when the work naturally separates into independently testable slices.

Good example:

- runtime/data foundation;
- editor/UI;
- physical integration;
- end-to-end verification.

Do not split trivial work merely to create more PRs.

### PRs are implementation units

A PR should be:

- based on current main;
- coherent enough to explain in one summary;
- independently mergeable;
- covered by the appropriate tests;
- squash merged.

Normal lifecycle:

`fresh main → short-lived branch → PR → CI → squash → automatic branch deletion`

`main` is protected and should remain green.

## Current-state maintenance

`docs/PROJECT_STATE.md` is the canonical snapshot for session recovery.

Update it when any of these happen:

- a major feature/milestone is completed;
- project architecture changes materially;
- a durable design direction changes;
- the work-discovery model changes;
- an important baseline/CI assumption changes;
- the listed current risks become misleading.

Do **not** use it as a changelog.

History belongs in Issues, PRs and Git.

## Decision recording

Use this rule:

- **why the game should behave this way** → `DESIGN.md`
- **what the project currently contains** → `PROJECT_STATE.md`
- **what must be done** → Issue
- **how it was implemented** → PR/code/tests
- **how ChatGPT/Work/project sessions should operate** → `PROJECT_OPERATIONS.md`

No important decision should exist only in a ChatGPT conversation.

## ChatGPT Project role

The ChatGPT Project should contain compact operating instructions, not copied snapshots of repository documents.

Prefer live GitHub access over uploading copies of README/DESIGN/PROJECT_STATE as Project files. Static copies drift.

The Project is useful for:

- grouping Pitwall Racer conversations;
- carrying stable interaction/operating instructions;
- making GitHub-first behaviour the default;
- keeping human preferences about how work should be performed.

It is not the work queue.

## Work role

Use Work for substantial multi-step tasks such as:

- implementing an Issue across multiple files;
- repository-wide refactors;
- debugging that requires repeated inspect/edit/test cycles;
- broad research followed by code/docs changes;
- project maintenance and migration tasks.

A Work task must bootstrap from GitHub, not from assumed memory.

Recommended Work startup sequence:

1. inspect `main`;
2. read `README.md`, `docs/PROJECT_STATE.md`, `docs/PROJECT_OPERATIONS.md`;
3. read the target Issue;
4. inspect relevant code/tests/PR history;
5. execute until acceptance criteria are met or a real blocker exists;
6. leave a GitHub checkpoint.

## Memory policy

Model memory may help with conversational convenience, but project correctness must never depend on it.

If memory and repository state disagree:

> **Repository state wins.**

If a useful memory-derived fact is not in GitHub and matters for future development, migrate it into the appropriate repository artifact before relying on it.
