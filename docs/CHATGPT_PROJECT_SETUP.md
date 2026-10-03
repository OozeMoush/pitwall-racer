# Pitwall Racer — ChatGPT Project + Work Setup

## Recommended ChatGPT Project

Create or use one dedicated ChatGPT Project named:

**Pitwall Racer**

Do not use the Project itself as a second project database. GitHub remains authoritative.

## Project instructions

Use the following as the ChatGPT Project instruction baseline.

```text
Pitwall Racer repository: OozeMoush/pitwall-racer.

Treat GitHub as the authoritative project source. Do not rely on chat history or memory for current implementation status, active work, design decisions or CI state.

At the start of project work:
1. inspect current main;
2. read README.md, AGENTS.md and docs/PROJECT_STATE.md;
3. read the relevant GitHub Issue and linked/open PRs;
4. for gameplay changes, also follow PLAYTEST.md and the repo pitwall-playtest skill.

GitHub Issues are the work queue and durable resume points. If substantial work has no Issue, create one. One large Issue may use several independently mergeable PRs; small Issues should normally stay one PR.

Normal code workflow:
fresh main -> short-lived branch -> PR -> required CI -> squash merge -> automatic branch deletion.
Do not normally push directly to main or revive stale feature branches.

Before finishing a substantial session, leave GitHub resumable: merged PR, open PR, or Issue checkpoint with completed work, verification, remaining work and blockers.

Record durable product/design decisions in DESIGN.md, current baseline changes in docs/PROJECT_STATE.md, agent/process rules in AGENTS.md or docs/PROJECT_OPERATIONS.md. Never leave an important project decision only in chat.

If repository evidence conflicts with memory, repository evidence wins.
```

Keep these instructions compact. Do not paste the entire README/DESIGN/current state into Project instructions.

## Project files

Prefer **not** to upload copies of repository markdown files as persistent Project files when live GitHub access is available.

Reason: copied files become stale and create two sources of truth.

If a file must be uploaded for a temporary workflow, treat it as a working copy and do not assume it remains current later.

## Recommended Project chat structure

Use separate chats for distinct purposes, for example:

- implementation / current Issue;
- design discussion;
- playtest and balancing;
- repository/project maintenance.

The chat is a workspace, not the final record. Durable outcomes still move to GitHub.

## When to use Work

Use Work when the task is substantial enough that repeated repository inspection, editing, testing or multi-step execution would otherwise make an ordinary chat fragile.

Examples:

- “Implement Issue #NN through green CI.”
- “Audit the current AI stack, create an Issue for concrete defects, then implement the highest-priority fix.”
- “Refactor the circuit editor across runtime/UI/tests and leave a PR.”
- “Research and migrate project operations, documenting the result in GitHub.”

## Work startup prompt

A minimal Work handoff can be:

```text
Work on OozeMoush/pitwall-racer Issue #NN to completion.

GitHub is the source of truth. Start from current main. Read README.md, AGENTS.md, docs/PROJECT_STATE.md, docs/PROJECT_OPERATIONS.md and the Issue before making changes. Follow the repository branch/PR/CI policy. For gameplay work also follow PLAYTEST.md and the pitwall-playtest skill.

Continue autonomously until the Issue acceptance criteria are complete or a genuine external blocker exists. Leave GitHub resumable with PR/CI status and an Issue checkpoint. Do not rely on prior ChatGPT conversation context.
```

## Migration verification

The migration is successful when a clean ChatGPT/Work session with no prior Pitwall Racer chat can, from GitHub alone:

1. explain the product direction;
2. describe the current main baseline;
3. identify active work from Issues;
4. state the important invariants and playtest gates;
5. follow the branch/PR/CI workflow;
6. implement or resume work without asking for old chat context.

Use Issue #134 to track this migration until that clean-session test has passed.
