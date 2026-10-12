# ClaudeタスクとChatGPTレビューの役割分担

状態: 運用方針として採用。Claude WorkerはOrca管理worktreeで実作業を行い、作成したPR・研究成果は必要に応じてChatGPTが独立したread-onlyレビューを行う。
結論: Claude自身が研究上の最終承認を行わず、ChatGPTのレビュー結果を受けた修正は新しいOrca指示として実行する。

## 背景

Orca Orchestrationの運用に慣れてきたため、Claude Workerの作業場所と、
実装後のレビュー主体を明確に分離する。

今後、Claude Workerが行うtracked fileの変更作業は、
原則としてOrcaが管理するClaude用worktree内で実施する。

一方、Claude Workerが作成したPRや研究成果については、
必要に応じてユーザーがChatGPTへ結果を渡し、
ChatGPTが独立したread-onlyレビューを行う。

## Claude Workerの役割

Claude Workerは、Orca Coordinatorから割り当てられたTaskだけを実行する。

主な役割:

- repo / source evidenceの確認
- 実装
- tests / validation
- docs更新
- commit / push
- PR作成
- 実行結果のCoordinatorへの報告

tracked fileを変更するTaskでは、
Orcaから割り当てられたClaude用worktree内だけで作業する。

canonical checkoutへ戻ってtracked fileを直接編集しない。

不明点や指示外の研究判断が必要になった場合は、
独自判断で先へ進まずCoordinatorへquestion / escalationする。

## Orca Coordinatorの役割

CoordinatorはClaude Workerの実行を監督し、必要に応じて:

- Task分解
- Worker起動
- worktree / branch / HEADの整合確認
- commit / push / PRの確認
- validation結果の回収
- Workerからのquestion / escalation処理
- 最終報告の統合

を行う。

Coordinator自身も、ChatGPT / ユーザーによって確定済みの研究判断を変更しない。

## ChatGPTレビューの役割

Claude Workerが作成したPRや研究成果について、
必要に応じてChatGPTがread-onlyレビューを行う。

主な確認対象:

- Orca向け指示書との整合
- frozen条件の維持
- preregistrationとの整合
- source evidenceとの整合
- acceptance criteria
- unexpected change
- validation結果
- GO / STOP判断
- 次の研究判断

ChatGPTへの「レビューお願いします」は原則read-onlyレビューを意味する。

明示的な依頼がない限り、
ChatGPT側からmerge / comment / approve等の変更操作を行わない。

## Claude自身による最終承認は行わない

Claude Workerは、自分が実装した変更について研究上の最終承認を行わない。

Claude Worker / Coordinatorの最終報告に:

- 未解決事項
- 判断が必要な点
- 想定外事項
- frozen条件との不一致
- source evidenceだけでは判断不能な点

がある場合は、それらを隠さず明示する。

合理的と思われる修正を独自に追加して研究判断を完了させない。

## レビュー後の修正

ChatGPTのレビュー結果によって修正が必要になった場合、
そのレビュー結果自体をClaude Workerが自動的に実行指示として扱わない。

修正内容をChatGPT / ユーザー側で確定し、
新しいOrca Coordinator向け実行指示として渡された場合のみ変更する。

これにより、

```text
ChatGPT / user
  ↓ 研究判断・実行指示
Orca Coordinator
  ↓
Claude Worker
  ↓ 実装・PR
Orca Coordinator
  ↓ 統合報告
user
  ↓
ChatGPT
  ↓ read-only review / GO・STOP / 次の研究判断
```

という責任境界を維持する。

## 基本方針

Claudeの実装能力とOrcaの実行管理を活用しつつ、
研究上のレビュー・GO / STOP判断を実装主体から分離する。

特にpreregistration、GT / fixture freeze、held-out evaluation、
one-shot evaluation等では、この独立性を維持することを優先する。
