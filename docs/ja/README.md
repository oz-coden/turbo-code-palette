# Turbo Code Palette 日本語ガイド・手動QAの始め方

対象は開発版 **0.0.1**、最低対応VS Code **1.134.0**です。正式リリース・Marketplace公開はまだ行いません。
TCPは言語・用途に依存しないSnippet / Pack管理ツールです。基本操作に.NETやAtCoder Policyは不要です。
TCPの操作名は現在英語です。このガイドでは画面・Command Palette上の正式名称を併記します。

最初はこのページで隔離環境を作り、[20〜30分のチュートリアル](tutorial.md)へ進んでください。

| 読むもの | 用途 |
| --- | --- |
| [ユーザーガイド](user-guide.md) | 日常操作、metadata、応用機能、設定 |
| [実践チュートリアル](tutorial.md) | JSで作成 → 検索 → Insert → Copy → 共有 → Clean Copy |
| [手動QAチェックリスト](manual-qa.md) | 操作数・発見性も記録する検証手順 |
| [不具合報告テンプレート](bug-report.md) | Codexへ渡す再現情報と共有前の伏字 |
| [準備作業の検証結果](qa-preparation-results.md) | 今回の確認範囲、生成VSIX、実装との照合で分かった制約 |
| [手動QA・Argonレビュー対応](../qa-feedback-review-results.md) | フィードバック後の修正・保証範囲・仕様承認待ちの提案 |
| [Phase 7結果](../phase7-results.md) / [既知制限](../known-issues.md) | 既存の自動テスト実績、未完了の実操作QA |

## 1. VSIXの用意

このrepositoryのルートで実行します。ソースからのビルドにはNode.js 24と.NET 10 **SDK**が必要です。
利用だけならSDKは不要で、C#高度機能のみ.NET 10 **runtime**を使います。

```powershell
npm ci
npm run package:vsix
```

`npm ci`は開発用依存を取得します。`package:vsix`は同梱するhelperをビルドし、型検査・lint・production bundle・VSIX作成・内容監査を行います。公開処理ではありません。
出力先は **`.vscode-test/turbo-code-palette-0.0.1.vsix`** です。`npm run package`だけではVSIXは作られません。
同じversionを再ビルドすると同じ出力名になるため、比較用VSIXを残すなら別名で退避してください。

すでに生成済みのVSIXを使う場合、ビルド用SDK・Node.jsはインストールに不要です。
以下のQA準備スクリプトにはNode.jsが必要です。TCPはruntimeを自動導入しません。

## 2. 推奨：個人環境を使わないQA

通常のVS Codeにインストールする前に、専用profile・extensions・Global root・Workspaceを作ります。
この手順は**ローカルのdesktop VS Code**を対象とします。Remote / WSL / Containerの検証とは区別してください。
Portable ModeのVS Codeは`data` folderが隔離引数を上書きするため、この手順では使わず、通常インストール版を使ってください。

```powershell
node scripts/prepare-manual-qa.mjs
```

表示された `QA run: .vscode-test/manual-qa/run-XXXXXX` を控えます。
毎回別のrunを新規作成し、既存run、個人設定、実Snippet Libraryを読み取ったり上書きしたりしません。
VS Codeの起動・インストール・ダウンロードも実行しません。

生成される内容：

| run配下 | 内容 |
| --- | --- |
| `tutorial` | libraryのない練習Workspace。合成入力・挿入先ファイルだけ配置 |
| `lab/.snippets` | 応用QA用2 Pack / 9 Snippet（JS / Python / HTML / optional C#） |
| `tutorial-profile`, `lab-profile` | 独立したVS Code設定・user state |
| `global-tutorial`, `global-lab` | 空の専用Global Library |
| `extensions` | QA専用の拡張インストール先 |
| `variants/QA-Conflict` | 初期libraryへ入れない意図的Conflict |
| `exports`, `reports` | 出力・記録用。チェックリストと報告雛形をコピー済み |
| `invalid-pack.tcp-sp` | Import拒否確認用の非ZIP合成text。共有用Packではない |

次のPowerShellで`run-XXXXXX`を実際に表示された名前へ置き換えます。
repositoryルートから実行してください。`code`が見つからない場合は、既存VS CodeのCLIをPATHへ設定するか、そのCLIの場所を指定します。

```powershell
$qa = (Resolve-Path '.vscode-test/manual-qa/run-XXXXXX').Path
code --user-data-dir "$qa/tutorial-profile" --extensions-dir "$qa/extensions" --install-extension '.vscode-test/turbo-code-palette-0.0.1.vsix' --force
code --new-window --user-data-dir "$qa/tutorial-profile" --extensions-dir "$qa/extensions" "$qa/tutorial"
```

`--force`は同じ0.0.1を再インストールするためです。**両方の隔離引数を必ず付けてください**。
このprofileでSettings Syncへサインインしたり、実際のGlobal rootへ変更したり、個人Workspaceを開いたりしないでください。
Workspace Trustが表示された場合、内容を確認したこの合成Workspaceについて判断します。準備スクリプトはTrustを無効化しません。

チュートリアル終了後、応用QAは別ウィンドウで開きます。インストール済みextensionsは共用ですが、設定・Global Library・Favorite等は別です。

```powershell
code --new-window --user-data-dir "$qa/lab-profile" --extensions-dir "$qa/extensions" "$qa/lab"
```

macOS / Linuxでは同じCLI引数を使えますが、上記の変数・`Resolve-Path`はPowerShellの構文です。
別shellではrunの絶対パスを各引数へ引用符付きで指定してください。
macOS等でIPC socketのパス長エラーが出た場合は、短い専用の`--user-data-dir`を別に用意し、
**そのprofileのGlobal Rootを空のQA用フォルダーに設定してから**操作してください。通常profileへ戻して続行しないでください。
今回の手動クリック手順の実測はWindows / Linux / macOSとも未実施です。
CLI引数の意味は[VS Code公式CLI資料](https://code.visualstudio.com/docs/configure/command-line)を参照してください。

## 3. 初回起動の確認

1. Extensionsで`@id:oz-coden.turbo-code-palette`を検索し、インストール済みversionが`0.0.1`であることを確認します。
2. Settingsで`@ext:oz-coden.turbo-code-palette`を検索します。`turboCodePalette.globalRoot`がそのrunの`global-tutorial`または`global-lab`を指すことを確認します。
3. 左Activity Barの**Turbo Code Palette**（paletteアイコン）を開きます。**Snippets / Packs / Clean Copy**が表示されます。
   非表示ならActivity Barの右クリックでTurbo Code Paletteを表示するか、Command Paletteの**View: Open View...**から`Snippets`等を選びます。
4. tutorialではSnippets / Packsが空、labでは2 Pack / 9 Snippetが見えることを確認します。FilterがAll・検索が空であることも確認します。
5. Policyが`none`、Source Attributionが`none`、Source MarkersとPreview Before InsertがOFFであることを確認します。
6. tutorialではC# Providerが`disabled`です。labの`auto`は既存runtimeを利用するだけです。C#を試す際は**Turbo Code Palette: C# Provider Status**で理由を確認します。

初回表示だけではlibraryファイルを作成しません。初回のSnippet作成でDefault Pack等が作成されます。
インストールしただけでCommand Paletteに見えない場合は**Developer: Reload Window**を実行します。
VS Code自身のUIが日本語の場合、VS Code組み込みコマンドは翻訳表示される場合があります。TCPの名前はこのガイドの英語表記です。

## 4. 通常のVS Codeへインストールする場合

1. まず既存のWorkspaceの`.snippets`、現在のGlobal Library、TCP設定をバックアップします。
   Globalの場所は**Turbo Code Palette: Reveal Global Library**で確認できます。
2. Extensionsの`...`メニュー → **Install from VSIX...**、またはCommand Paletteの**Extensions: Install from VSIX...**からVSIXを選びます。
3. 要求されたらReloadします。Side Barを開き、Global Rootと表示内容を確認してから作成・Delete・Importを試します。

通常profileへのCLIインストールは次のとおりです。このコマンドには隔離指定がないため、実利用環境へ入ります。

```powershell
code --install-extension '.vscode-test/turbo-code-palette-0.0.1.vsix' --force
```

実データを使う試験と合成QAを混在させないでください。Global Rootを変えてもデータは自動移動されません。
アンインストールをlibraryバックアップ・消去の代用にしないでください。
VSIXの選択と拡張管理は[VS Code公式拡張管理資料](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)も参照できます。

## 5. 更新・アンインストール・やり直し

- **更新**：対象のQAウィンドウを閉じ、新しいVSIXを同じ`--user-data-dir` / `--extensions-dir`指定で再インストールし、開き直します。versionが同じなのでVSIXのSHA-256やソースcommitも記録します。
- **無効化 / アンインストール**：ExtensionsでTCPの歯車 → **Disable / Uninstall**。QA用CLIなら次を使います。

```powershell
code --user-data-dir "$qa/tutorial-profile" --extensions-dir "$qa/extensions" --uninstall-extension oz-coden.turbo-code-palette
```

- **やり直し**：準備スクリプトをもう一度実行し、別runを使います。既存runを初期化・削除するコマンドは用意していません。
- **片付け**：QAウィンドウを閉じ、必要な報告・archiveを退避した後、対象runだけを手動で削除できます。個人Global / Workspaceや追跡中fixtureは削除しないでください。

生成runとVSIXはGit管理対象外です。runのsettingsには実マシンの絶対パスがあるため、丸ごと公開・添付しないでください。
日本語ガイドとfixtureはrepository側の資料です。VSIXに同梱される英語ガイドとは別に、このディレクトリを参照してください。

## 6. .NETの要否と次の行動

| 操作 | .NET 10 |
| --- | --- |
| Snippet / Pack管理、検索、基本Insert、Template、metadata依存解決、Copy、ZIP Import / Export | 不要 |
| generic Clean Copy、Clipboard / Preview / Save As、依存review JSON | 不要 |
| C# exports候補、syntax-aware構造挿入、semantic collision / Bundle、C#追加Clean変換 | 既存runtimeが必要 |
| ソースからhelper / VSIXをビルド | SDKが必要 |

runtime不足ならStatusの理由を記録し、汎用QAを続けてください。ここでruntimeを自動インストールする手順はありません。
まず[チュートリアル](tutorial.md)、次に[手動QAのP0](manual-qa.md)、その後P1・P2を進めます。
