# mGB MIDI シーケンサー WebSocket サーバー

このリポジトリには、mGB MIDI シーケンサーのWebSocketサーバーと接続するための Claude MCP (Model Context Protocol) サーバーが含まれています。

## セットアップ

### 前提条件

- Node.js 18.x 以上
- npm 8.x 以上
- Claude Desktop (MCP対応版)
- mGB MIDI シーケンサー WebSocketサーバー ([GitHub: mGB-MIDI-Sequencer](https://github.com/otanl/mgb-midi-sequencer))

### インストール

```bash
cd mgb-mcp
npm install
npm run build
```

## 使用方法

### WebSocketサーバーの起動

WebSocketサーバーは別のプロジェクト（[mGB-MIDI-Sequencer](https://github.com/example/mgb-midi-sequencer)）から起動する必要があります。セットアップと起動方法については、そのプロジェクトのドキュメントを参照してください。

WebSocketサーバーは `ws://localhost:8765` でリッスンするように設定されています。MCPサーバーはこのアドレスに接続を試みます。

### WebSocketサーバーアドレスの設定

MCPサーバーがWebSocketサーバーに接続するためのアドレスは、以下の方法で設定できます（優先順位順）：

1. **環境変数**:
   `.env`ファイルまたはシステムの環境変数として`WEBSOCKET_URL`を設定します。
   例: `WEBSOCKET_URL=ws://192.168.1.100:8765`

2. **設定ファイル**:
   `config.json`ファイルに`websocketUrl`プロパティを設定します。
   例:
   ```json
   {
     "websocketUrl": "ws://192.168.1.100:8765"
   }
   ```

3. **ログファイルの自動検出**:
   MCPサーバーは起動時に`app_log.txt`ファイルを自動的に検索し、そこに記録されたWebSocketサーバーアドレスを使用します。以下の場所のファイルを検索します:
   - カレントディレクトリ
   - 親ディレクトリ
   - 親ディレクトリの`mGB-MIDI-Sequencer`フォルダ

4. **デフォルト**:
   上記の方法で設定が見つからない場合、デフォルトの`ws://localhost:8765`が使用されます。

### HTMLクライアントの使用

mGB-MIDI-Sequencerプロジェクトに含まれる `midi_sequencer_client.html` ファイルをブラウザで開いて、MIDIシーケンサーを操作できます。WebSocketサーバーが起動していることを確認してください。

### Claude MCPサーバーの設定

Claude Desktopでは、`claude_desktop_config.json` ファイルにMCPサーバーが設定されています。
以下の設定がすでに追加されているはずです：

```json
{
  "mcpServers": {
    "mgb-mcp": {
      "command": "node",
      "args": [
        "F:/py/mcp/mgb-mcp/build/index.js"
      ]
    }
  }
}
```

Claude Desktopを再起動すると、MCPサーバーが自動的に読み込まれます。

### ClaudeでのMCPの操作

Claudeに自然な言葉で指示を送ることで、MIDIシーケンサーを操作できます。以下のような指示を試してみてください：

#### 基本操作
- 「シーケンサーの現在の状態を教えてください」
- 「シーケンサーを再生してください」または「再生を停止してください」
- 「BPMを140に設定してください」

#### シーケンスパターンの操作
- 「トラック0の4番目のステップをオンにしてください」
- 「PU1トラックの全てのステップをクリアしてください」
- 「WAVトラックに4つ打ちのパターンを設定してください」
- 「ドラムパターンを作成してください」

#### 音色パラメータの制御
- 「PU1トラックのパルス幅を80に設定してください」
- 「PU2トラックのエンベロープを調整してください」
- 「WAVトラックのピッチスイープを30に設定してください」
- 「NOISEトラックの音色を変更してください」

#### 複雑な操作
- 「16ビートのベースラインを作ってください」
- 「アルペジオパターンを作成してください」
- 「テクノスタイルのシーケンスを作ってください」
- 「現在のパターンにバリエーションを加えてください」

#### MIDI設定
- 「利用可能なMIDI出力デバイスを教えてください」
- 「MIDI出力をMicroFreakに変更してください」
- 「MIDIクロックを有効にしてください」

## APIの重要な注意点

### update_ccコマンドの特別な処理

`update_cc`コマンドは、他のコマンドと異なる特別な処理を行います：

1. **レスポンスを返さない**: このコマンドは送信元クライアントに直接レスポンスを返しません。
2. **UIの即時更新**: クライアントは送信後、自身のUI上でCC値を即座に更新して処理を続行する必要があります。
3. **非同期処理**: レスポンスを待たずに次の処理に進んでください。

例：
```javascript
// 正しい実装方法
function updateCC(track, cc, value) {
  // 1. まずUIを更新
  updateUIDisplay(track, cc, value);
  
  // 2. サーバーにコマンドを送信（レスポンスを待たない）
  ws.send(JSON.stringify({
    command: 'update_cc',
    track: track,
    cc: cc,
    value: value
  }));
}
```

## トラブルシューティング

### WebSocketサーバーへの接続エラー

HTML MIDIシーケンサークライアントが「切断」状態になっている場合は、以下を確認してください：

1. mGB-MIDI-Sequencerプロジェクトの WebSocketサーバーが起動しているか
2. ポート8765がアクセス可能か
3. ファイアウォールの設定

### 制御系（CC）パラメータの更新が反映されない

制御系パラメータ（エンベロープ、パルス幅など）の更新で問題が発生した場合：

1. **レスポンス待ちの確認**: `update_cc`コマンドはレスポンスを返さないため、レスポンスを待つ処理があればそれを削除
2. **パラメータ形式の確認**: トラック名と制御系パラメータの名前が正確か確認
3. **値の範囲の確認**: 値が0〜127の範囲内か確認

例：
```javascript
// 間違った実装（レスポンスを待っている）
async function wrongUpdateCC() {
  const response = await sendCommand({command: 'update_cc', ...}); // NG: レスポンスが返らないためエラーになる
}

// 正しい実装
function correctUpdateCC() {
  sendCommand({command: 'update_cc', ...}); // OK: レスポンスを待たない
  updateUI(); // すぐにUIを更新
}
```

### undefinedエラーの防止

CCパラメータや他のオブジェクトプロパティにアクセスする前に、オブジェクトの存在を確認してください：

```javascript
// 良い例：プロパティの存在を確認
if (state.cc_values && state.cc_values.PU1 && state.cc_values.PU1.cc1 !== undefined) {
  const value = state.cc_values.PU1.cc1;
  // 処理を続行
}
```

### ClaudeのMCPサーバーの接続エラー

MCPサーバーがWebSocketサーバーに接続できない場合、Claudeのレスポンスに「Error: Not connected」などのメッセージが含まれます。
この場合は、WebSocketサーバー（mGB-MIDI-Sequencerプロジェクト）が実行されていることを確認してください。

## 詳細なAPIドキュメント

詳細なAPI仕様については、`ref/api_documentation.md`を参照してください。このドキュメントには以下が含まれています：

- 全コマンドの詳細な説明
- リクエスト/レスポンス形式
- エラーハンドリング方法
- サンプルコード

## ライセンス

このプロジェクトはMITライセンスでライセンスされています。
