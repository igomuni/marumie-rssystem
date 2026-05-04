---
name: resolve-reviews
description: Use when the user asks to address unresolved GitHub PR review comments in this repository, such as "resolve-reviews PR 190", "PR #190 のレビュー対応", or "未解決レビューコメントに対応して".
compatibility: Requires git, gh CLI, npm, and npx. GitHub CLI must be authenticated for the target repository.
allowed-tools: Bash(git:*) Bash(gh:*) Bash(npm:*) Bash(npx:*) Read Edit Grep Glob
---

# Resolve PR Review Comments

指定された PR の未解決レビューコメントを確認し、必要な修正・確認・報告を行う。

## Inputs

- PR number from the user's request.
- If no PR number is provided, ask the user for it.

## Workflow

1. Confirm repository and PR.

```bash
git branch --show-current
gh pr view <PR_NUMBER> --json number,title,headRefName,baseRefName,state,url
```

If the PR does not exist, report the error and stop.

2. Check out the PR branch when needed.

```bash
gh pr checkout <PR_NUMBER>
```

Before switching branches, check `git status --short`. If unrelated local changes exist, report them and avoid overwriting them.

3. Fetch unresolved review threads.

```bash
gh api graphql \
  -F owner=igomuni \
  -F name=marumie-rssystem \
  -F number=<PR_NUMBER> \
  -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 20) {
            nodes {
              id
              path
              line
              body
              author { login }
            }
          }
        }
      }
    }
  }
}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

4. Fetch PR-level review summaries.

```bash
gh api repos/igomuni/marumie-rssystem/pulls/<PR_NUMBER>/reviews \
  --jq '.[] | select(.state == "CHANGES_REQUESTED" or .state == "COMMENTED") | {id: .id, body: .body, user: .user.login, state: .state}'
```

5. Analyze comments and classify each item.

- Code change needed: inspect the referenced file and implement a focused fix.
- Answer needed: draft the response and ask the user when the answer depends on intent or policy.
- Needs decision: explain the tradeoff and ask the user before changing behavior.
- Already resolved or obsolete: ignore resolved threads; mention if a visible comment is no longer applicable.

When applying reviewer suggestions:

- Treat filenames, timestamps, branch names, command arguments, and placeholder-looking values in comments as examples unless they match the current repository context.
- Before creating or renaming timestamped docs, compute the actual local timestamp instead of copying example values:

```bash
TZ=Asia/Tokyo date '+%Y%m%d_%H%M'
```

- Verify suggested paths and line numbers against the current files. If the exact value cannot be inferred from local context, ask the user or state the assumption clearly.

6. Validate.

Run checks only when relevant to the changes. For source changes, prefer:

```bash
npm run lint
npx tsc --noEmit
```

If a check cannot be run, report why.

7. Commit and push when code or docs were changed.

Use a review-response commit message, for example:

```text
fix: address review comments on PR #<PR_NUMBER>
```

Push the PR branch after committing.

8. Report results.

Use this format:

```markdown
## レビュー対応完了

### 対応済み
- **path:line** 対応内容

### 未対応（要確認）
- **コメント概要** 理由 / 確認したいこと

### 検証
- 実行したコマンドと結果

### 次のアクション
- 必要なら残タスク
```

## Rules

- Do not process review threads where `isResolved == true`.
- Do not resolve GitHub threads unless the user explicitly asks.
- Do not make large design changes without user confirmation.
- Do not overwrite unrelated local changes.
- Prefer small, review-scoped commits.
- Do not copy example values from review comments into code, docs, or filenames without resolving them against the actual context first.
