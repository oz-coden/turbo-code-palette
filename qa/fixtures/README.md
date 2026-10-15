# 手動QA用の合成データ

個人のSnippetや実在の公開証拠を含まない、TCP自身の検証用データです。
`example.com`のURL・公開日時は架空の申告であり、AtCoderの提出条件を満たす証明ではありません。
license noticeも保持テスト用の文字列で、TCP本体のライセンスを変更しません。

`node scripts/prepare-manual-qa.mjs`で、無視対象の専用runへコピーしてください。
このディレクトリを個人のGlobal rootへ直接指定しないでください。

| ディレクトリ | 用途 |
| --- | --- |
| `library/QA-Web` | JS / Python / HTML、Template、依存、複数source、出典・通知 |
| `library/QA-CSharp` | optional Roslyn、structure-aware、semantic Bundle |
| `variants/QA-Conflict` | QA Greetingと同一UUID/version、異なるsource。初期libraryへは入れない |
| `workspace` | チュートリアル入力と空の挿入先、C#解析入力 |

準備後、`tutorial`にはlibraryがなく、`lab/.snippets`には2 Pack / 9 Snippetが入ります。
`variants`はrun直下に隔離してコピーされます。Conflict試験時だけlabへ追加します。
`tutorial-profile`と`lab-profile`は別設定・別Global rootです。extensionsディレクトリのみ共有します。
実行結果、アーカイブ、スクリーンショット、不具合記録はrun配下へ保存してください。

操作手順は[日本語の開始ガイド](../../docs/ja/README.md)と[手動QA](../../docs/ja/manual-qa.md)を参照してください。
