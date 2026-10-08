# v1 明示Insert方針

2026-10-09、追加D&D UX調査後の利用者指示で確定。提供仕様書・初回reviewにあるD&D優先の記述よりこの決定を優先する。

基本手順は **editorで挿入位置を選ぶ → Snippetを検索/選択する → Insertを実行する**。

一覧のInsert button、右クリックInsert menu、Command Palette/keyboard-accessible command、Pack詳細内のSnippetのInsertをすべて共通Insertion pipelineへ接続する。選択/previewだけで本文は変更しない。キーボード利用者はcommandから検索・選択して実行できるようにする。

pipelineの責務と段階:

| 段階 | 責務 |
| --- | --- |
| Phase 1 | loader、format状態、identity/conflict、version、検索、安全なpathの共通基盤 |
| Phase 2 | 実Snippet一覧・検索・詳細・Pack詳細のUI。Insert入口は共通commandへのadapterとする |
| Phase 3 | target URI/version/selection capture → asset/format/conflict検証 → dependency/template input → insert mode/provider → preview → targetとassetの再検証 → 一括適用/Undo |

一覧button・右クリック・command・Webview buttonの内部で個別の挿入規則を実装しない。Webview messageはasset identityと要求modeを検証し、任意code/pathを信頼しない。非text editorにfocusが移っても直前の有効targetを保持し、async選択/input/preview後はdocument versionとasset fingerprintを再検証する。変更時は部分適用を止め、位置選択と再計画へ戻す。

template、dependency、conflict、preview、insert mode、stale target validationは明示Insertを中心に設計する。D&D非対応/無効の環境でもこれらの主要機能を提供する。特にreplace-selectionは明示Insertのcapture済みselectionを使う。

native Shift-required D&Dは補助機能。Phase 1のdemoでは`turboCodePalette.enableAuxiliaryDragAndDrop`を既定falseにし、reload後にのみ登録する。利用する場合は左ボタンで掴む→editorへ移動→Shift保持→左ボタンを離す。Shift+click/右クリックという説明は使わない。VS Codeのdrop設定は自動変更しない。

今後D&Dに改修が必要なら廃止を検討してよい。未知の競合D&D actionやVS Codeとの干渉が起きた場合は積極的に廃止する。互換性維持のために主操作を複雑化しない。Webview D&D、raw text fallback、非公開API、内部workbench挙動に依存して通常dropを成立させようとしない。将来の競合を検出するための非公開APIによる監視は追加しない。

実験用UX LabはPhase 1でruntime/sourceから除去。比較結果は[D&D UX調査](dnd-ux-investigation.md)に保存し、PoC当時のsourceはGitの`2df07c1`で参照できる。

Phase 1の実挿入は合成demoのみ。Phase 2では実Snippet一覧button・右クリック・command・Pack詳細buttonを共通`InsertionAdapter`へ接続した。handler未接続の現在は案内のみで、本文/file/usageを変更しない。完成pipelineはPhase 3の責務。合成demoは製品viewから分離し、既定非表示とした。[Phase 2結果](phase2-results.md)を参照。Phase 2完了後は報告して停止し、Phase 3へ自動で進まない。
