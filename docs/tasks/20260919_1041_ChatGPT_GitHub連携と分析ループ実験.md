# ChatGPT GitHub連携と分析ループ実験

## 目的

音声チャットとタイプチャット、ChatGPTの仮想環境、GitHub連携を組み合わせ、marumie-rssystem のデータ分析・壁打ち・ドキュメント化・実装指示へつなげる一連のループが成立するかを確認する。

## 今回確認できたこと

### 1. ChatGPT仮想環境でのファイル操作

会話中に `/mnt/data` の内容を確認し、アップロード済みのMOF/RS関連データを同一セッション内で扱えることを確認した。また、Markdownを仮想環境に生成し、`ls` で実在確認できた。

### 2. 音声チャットとタイプチャットの使い分け

音声チャットは壁打ち・仮説整理には使いやすい一方、コマンド実行結果やファイル生成などの細かい作業はタイプチャット側の方が確認しやすいことを実験的に確認した。

### 3. 仮想環境からGitHubへの直接 clone

仮想環境から対象ブランチを `git clone` する実験では、外向きネットワーク制約により `github.com` を名前解決できず失敗した。したがって、仮想環境のシェルから直接GitHubを取得する経路とは別の経路が必要。

### 4. GitHub連携によるリポジトリ参照

GitHub連携後は `igomuni/marumie-rssystem` のブランチ情報とGit treeを直接参照できた。

対象ブランチ:

```text
fix/integrated-sankey-tab-persist
```

確認時HEAD:

```text
aeb41147604a45744bb54c556422bf01ce76df2f
```

先に作成してユーザー側からcommit/pushした実験ログもGitHub側で確認できた。

```text
docs/tasks/20260919_1025_marumie-rs-chatgpt-analysis-practice.md
```

### 5. GitHub連携の書き込み権限

GitHub連携から対象ブランチへ task doc の作成を試したところ、`403 Resource not accessible by integration` となった。現状の連携はリポジトリの読み取りには利用できるが、直接commitする経路としては利用できない。

### 6. 既存ディレクトリ構造との接続点

今回の分析ループに関係しそうな既存構造として以下を確認した。

```text
.agents/skills/
docs/
├── exports/
├── logs/
└── tasks/
    ├── _assets/
    ├── archive/
    └── INDEX.md
scripts/
```

新しい大きな分析用ディレクトリを即座に追加するより、既存の `.agents/skills/`、`docs/tasks/`、`docs/logs/`、`docs/exports/`、`scripts/` の役割を確認してから配置を決める方が自然と判断した。

## ファイル命名規約の確認

`CLAUDE.md` の Documentation Standards に以下の規約がある。

- Task docs（設計・調査・実装計画）: `docs/tasks/YYYYMMDD_HHMM_タイトル.md`
- Architecture guides（恒久的な参照ドキュメント）: `docs/*.md`

本ファイルは実験・調査記録なので task doc として保存する。

また `docs/tasks/INDEX.md` には「task doc を新規作成したら本索引に1行追記する（新しいものを上に）」という運用ルールがある。

## 現時点のループ

```text
marumie RS / MOFデータ
        ↓
必要データをローカルで取得・パッケージ化
        ↓
ChatGPTセッションへ投入
        ↓
会話で探索・仮説・検証
        ↓
Markdownへ記録
        ↓
GitHubへcommit
        ↓
Codex / Claude Code等の実装エージェントへ指示
        ↓
UI/API/データ提供方法を改善
        ↓
再びChatGPTで分析
```

今回、このループの最小形を一周できた。

## 次に確認すること

既存設計との重複を避けるため、以下の文書・スキルを先に読む。

- `docs/tasks/20260705_1628_レポート駆動の自己改善ループ.md`
- `docs/tasks/20260719_0852_チャット起点レポート機能_実験計画.md`
- `docs/tasks/20260913_0942_統合サンキー壁打ちメモ.md`
- `docs/tasks/20260919_1025_marumie-rs-chatgpt-analysis-practice.md`
- `.agents/skills/` 配下の関連スキル

そのうえで、次を整理する。

1. ChatGPTへ渡すデータパッケージの生成場所・形式
2. セッション中の生ログと整理済みtask docの分離
3. Git管理する成果物と一時生成物の境界
4. パッケージ生成を `scripts/` に置くか、Agent Skillとして扱うか
5. ChatGPTで得た分析結果をCodex / Claude Code向け実装指示へ変換する手順

## 補足

この文書自体も「ChatGPTで調査・整理 → GitHub連携でリポジトリ規約を確認 → ローカル仮想環境へ規約に沿って成果物を配置」という経路の実証成果物である。
