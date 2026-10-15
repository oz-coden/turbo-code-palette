# Turbo Code Palette 不具合報告テンプレート

runの`reports/bug-report.md`へコピー済みです。問題ごとに別名で保存してください。
コードブロック内を埋め、必要な合成Snippet / PackとともにCodexへ渡せます。

## 共有前に確認すること

- 個人名、username、home / 絶対ローカルpath、workspace名は`<USER>` / `<QA_ROOT>` / `<WORKSPACE>`へ一般化してください。
- API key / token / password / cookie / credential / `.env`の中身は添付しないでください。値は伏せても形式・エラーcodeは記録できます。
- screenshotはtitle bar、Explorer、terminal、notification、recent一覧に個人情報がないか確認してください。
- logは該当時刻の必要部分だけにします。settings全体、Global Library全体、run全体をそのまま送らないでください。
- archive / metadataのauthor、source URLのprivate query、コード内の秘密情報も確認します。合成fixtureで再現できるならそちらを使います。
- TCP / VS Codeのエラーにpathが含まれる場合は、伏字後もfile間の関係が分かる相対pathを残します。

## 記入用

```text
件名：
関連QA ID：
重要度：Blocker / High / Medium / Low
  Blocker: データ損失、秘密情報混入、主要操作を続行できない
  High: 主要機能の失敗・誤結果（回避策あり含む）
  Medium: 機能制限・分かりにくさ・復帰困難
  Low: 表示・文言・軽い操作性

環境：
  OS / architecture：
  VS Code version / commit（Help: About または code --version）：
  TCP version：
  ソースcommit / VSIX SHA-256（分かれば）：
  通常 / 隔離profile、Local / Remote：
  C# Provider: disabled / auto / custom、Statusの内容（伏字済み）：
  .NET runtime version（C#の場合、既存の dotnet --list-runtimes）：
  Workspace Trust、関連する他の拡張：

使用データ：
  合成fixture名 / Pack / Snippet名 / UUID / asset version：
  source相対path / 言語 / 改行形式：
  Global / Workspace、既知の複数location・conflict有無：

操作条件：
  入口（inline / context / palette / Pack詳細等）：
  Insert Mode：
  Source attribution / identity marker / preview：
  Clean scope / preset / transforms / output：
  Compliance Policy / contest start（必要な場合）：
  cursor / selection位置、未保存内容の有無：

再現手順：
  1.
  2.
  3.
期待結果：
実際の結果：
エラーメッセージ（原文、秘密情報・絶対pathは伏字）：
再現頻度：例 3回中3回 / 一度だけ
最後に正常だった操作・commit（分かれば）：

操作性：
  目的達成までの実クリック数 / keyboard操作数 / 所要時間：
  説明なしで入口を発見できたか：はい / いいえ / 未試験
  迷った表示、focus / Tab / Esc / Undoの挙動：
  エラー後の復帰手順 / 回避策：

データへの影響：
  元document / library / clipboard / output / user stateが変化したか：
  一回のUndoで戻ったか（該当する場合）：
添付：
  screenshot / screen recording：あり / なし（伏字確認済みか）
  log：あり / なし（対象時刻と取得方法）
  最小再現fixture / archive：あり / なし
```

logが必要なときはVS Codeの**Developer: Show Logs...**や**Developer: Toggle Developer Tools**で該当errorを確認できます。
TCPのC# helperはprotocol用stdoutとは別にstderrを使いますが、一般利用者向けに全helper logを保存・出力する専用UIはありません。
存在しないlog fileを探す必要はありません。まず画面のerrorと**Turbo Code Palette: C# Provider Status**の理由を記録してください。
