# Phase 0 実証結果

検証日: 2026-10-08（日本時間）。対象はWindows x64、VS Code 1.134.0（最低対応版）と1.140.0（インストール済み版）。Phase 0のみを実装し、Phase 1以降には進んでいない。

## 判定

**Phase 0のacceptance criteriaを満たした。native TreeView → editor D&Dは実現可能。**

技術的実証の承認後、主操作の発見性を追加調査した。[D&D UX比較報告](dnd-ux-investigation.md)を参照。以下は最初の実証記録であり、Shift-required操作を製品UXとして確定したという意味ではない。

実操作の手順は次の順序になる。

1. Snippet行を左クリックで掴む。
2. 対象text editor内の挿入位置へ移動する。
3. **Shiftを押しっぱなしにする。**
4. 左マウスボタンを離す。
5. Shiftは任意のタイミングで解除できる。挿入が反映される。

Shiftを最初から押して行をクリックする操作やShift+右クリックではない。通常ドラッグの実験ではtreeのdrag callbackは呼ばれたがeditorのdrop providerは呼ばれず、documentは変わらなかった。通常dropだけで常に挿入できるとは表現しない。

## 証拠と検証範囲

| 検証 | 結果 / 実施方法 |
| --- | --- |
| native tree drag callback | Windows UI操作で確認。diagnosticsのdragCount=1 |
| 通常drop | editor provider requested=0、document不変を画面とdiagnosticsで確認 |
| native cursor drop | 利用者が実Extension Development Hostで、editorへ移動後にShiftを押して指定位置へ挿入できたと確認 |
| native EOF drop | 同じ手順で途中の位置へdropし、末尾へ挿入できたと利用者が確認 |
| native Undo | cursor/EOFの両方がCtrl+Z一回で元に戻ったと利用者が明示確認 |
| core / public-scan unit tests | 13件成功 |
| Extension Host integration / 1.134.0 | 11件成功、exit code 0 |
| Extension Host integration / 1.140.0 | 11件成功、exit code 0 |
| type / lint / bundle | 成功 |
| 公開前チェック | tracked/untracked候補、Git index、既存履歴、差分を確認。個人用絶対path/秘密値の検出なし |

自動Hostテストは本物のExtension Host内でtree controllerとDropEditProviderを呼び、VS Codeのdocument/edit/Undo APIを検証する。マウスの実dragを自動Hostテストが行ったという意味ではない。native挿入とnative Undoは上記の利用者による実操作確認を証拠とする。

Windows UI操作は途中で物理Escキーにより停止された。その後のWindows UI自動操作は行っていない。独立したCLIの自動テストと公開前チェックは完了した。

## 実装内容

- Activity BarのTCP containerとnative Snippet TreeView。cursor/EOFの2つの合成demo。
- treeの`text/uri-list` → 短命のopaque `tcp-snippet:` URI → 登録済みDropEditProvider。
- 同一拡張instanceが発行したsessionだけを受理。2分の有効期限、最大128件、cancel/複数項目/不正URIの拒否。
- actual drop document/positionを使う共通text planner。cursorはinsertText、EOFは空insertTextとadditionalEdit。
- provider計算はdocument/fileを変更しない。document変更、drop無効設定、cancelを検出してeditを返さない。
- 明示Insert、仮想source preview、drop target作成、path/source/session IDを出力しない診断コマンド。
- previewで元TextEditorが破棄されるケースを発見・修正。document/positionを保持して挿入時にeditorを取得し直す。
- unit/Hostテスト、最低対応版を固定する設定、隔離した開発profile、GitHub Actionsのbuild/unit/Host job。
- `.gitignore`と公開前scan。必要なsource/lockfile/fixtures/docs/portable IDE設定は保持。

仮想previewにはfilesystem writerを登録しない。VS CodeのUIでは読み取り専用表示になるが、他の拡張がAPI経由でメモリー内documentを編集できないことまで保証しない。TCPのInsertはpreviewを対象にせず、合成source自体も変更しない。

## 承認時の設計修正

`formatVersion`（metadata schema）とasset `version`を独立させた。意味不変migrationはformatVersionだけをin-place更新し、asset version増加を要求しない。source/意味論/依存などassetの意味が変わる時だけ通常のversion規則を使う。integrity hashとschema表現非依存のsemantic fingerprintを分ける設計へ変更した。migration実装はPhase 1の範囲。

## 再現手順

```sh
npm ci
npm run compile
npm run test:unit
npm test
```

`npm test`はVS Code 1.134.0をignored test領域へ取得してGUI Hostを起動する。インストール済みWindows VS Codeで比較する場合は`npm run test:host`。別環境では環境変数TCP_VSCODE_EXECUTABLEに実行fileを指定できるが、その個人pathはrepositoryへ保存しない。

実dragの再現は`npm run dev:host`で隔離Hostを開き、command paletteから`Turbo Code Palette: Open Phase 0 Drop Target`を実行する。上述の順序で両demoをdropし、Ctrl+Zで戻す。右クリックのInsert Demo Snippetも利用できる。editor.dropIntoEditor.enabledが必要であり、通常利用者の設定をTCPが勝手に有効化しない。

開発profile、download runtime、raw logs、compiled testsは`.vscode-test/`、`out/`、`dist/`等にのみ置きGitから除外する。Global/Workspace Snippet storageを作成しない。

## 未解決・今後の範囲

- native mouse操作の実証はWindows/1.140.0のみ。1.134.0はHost API連携で検証済み。macOS/Linux/Remoteや他のdrop providerとの優先順位はrelease前に追加検証する。
- 複数選択は可能だが複数Snippet D&Dは対象外。
- Phase 0は固定demoのtext挿入。実Snippet/Pack discovery、open metadata editor、semantic asset identity、migration、依存/template、structure-aware、ZIP/Clean Copyは未実装。
- GitHub Actionsを追加したが、ローカルHostテストの成功とCIの実行結果は別に扱う。

次の着手範囲はPhase 1。新たな指示まで後続Phaseの実装を開始しない。
