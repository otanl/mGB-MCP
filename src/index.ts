#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import os from "os";
import {
  MgbState,
  WsResponse,
  WsCommand,
  isSetBpmArgs,
  isToggleStepArgs,
  isSetNoteArgs,
  isSendPresetArgs,
  isChangeMidiOutputArgs,
  isChangeMidiInputArgs,
  isToggleMidiClockArgs,
  isUpdateCcArgs,
  isBatchUpdateArgs
} from "./types.js";

// 環境変数のロード
dotenv.config();

/**
 * Type alias for a note object.
 */
type Note = { title: string, content: string };

/**
 * Simple in-memory storage for notes.
 * In a real implementation, this would likely be backed by a database.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" }
};

/**
 * システムのローカルIPアドレスを検出
 * @returns 見つかったIPv4アドレスの配列
 */
function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  // 各ネットワークインターフェースを走査
  Object.keys(interfaces).forEach(ifaceName => {
    const iface = interfaces[ifaceName];
    if (!iface) return;

    // IPv4アドレスのみを抽出（内部ループバックアドレス以外）
    iface.forEach(details => {
      if (details.family === 'IPv4' && !details.internal) {
        addresses.push(details.address);
      }
    });
  });

  return addresses;
}

// WebSocketアドレスを取得する関数
function getWebSocketAddress(): string {
  // 方法1: 環境変数から取得
  if (process.env.WEBSOCKET_URL) {
    console.error("[MGB MCP] Using WebSocket address from environment variable:", process.env.WEBSOCKET_URL);
    return process.env.WEBSOCKET_URL;
  }
  
  // 方法2: config.jsonから取得
  try {
    const configPath = path.resolve(process.cwd(), "config.json");
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      if (config.websocketUrl) {
        console.error("[MGB MCP] Using WebSocket address from config.json:", config.websocketUrl);
        return config.websocketUrl;
      }
    }
  } catch (err) {
    console.error("[MGB MCP] Error reading config.json:", err);
  }
  
  // 方法3: app_log.txtからアドレスを取得
  try {
    // app_log.txtの場所を推測する方法がいくつかあります
    // 1. カレントディレクトリ
    // 2. 1レベル上のディレクトリ
    // 3. 親ディレクトリのmGB-MIDI-Sequencerディレクトリ
    const possibleLogPaths = [
      path.resolve(process.cwd(), "app_log.txt"),
      path.resolve(process.cwd(), "..", "app_log.txt"),
      path.resolve(process.cwd(), "..", "mGB-MIDI-Sequencer", "app_log.txt")
    ];
    
    for (const logPath of possibleLogPaths) {
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const match = logContent.match(/WebSocketサーバー: (ws:\/\/[0-9.]+:[0-9]+)/);
        if (match && match[1]) {
          console.error("[MGB MCP] Using WebSocket address from app_log.txt:", match[1]);
          return match[1];
        }
      }
    }
  } catch (err) {
    console.error("[MGB MCP] Error reading app_log.txt:", err);
  }
  
  // 方法4: OSのネットワークインターフェースからIPアドレスを取得して試す
  try {
    const localIPs = getLocalIpAddresses();
    if (localIPs.length > 0) {
      // 複数のIPアドレスが見つかった場合は最初のものを使用
      const wsAddress = `ws://${localIPs[0]}:8765`;
      console.error("[MGB MCP] Using detected local IP address:", wsAddress);
      console.error("[MGB MCP] Available local IPs:", localIPs.join(", "));
      return wsAddress;
    }
  } catch (err) {
    console.error("[MGB MCP] Error detecting local IP addresses:", err);
  }
  
  // デフォルトアドレスに戻る
  console.error("[MGB MCP] Using default WebSocket address: ws://localhost:8765");
  return "ws://localhost:8765";
}

// WebSocketクライアント設定
const WS_URL = getWebSocketAddress();
let wsClient: WebSocket | null = null;
let currentState: MgbState | null = null;
let isConnected = false;

// mGB MCPサーバー
class MgbServer {
  private server: Server;
  
  constructor() {
    this.server = new Server({
      name: "mgb-mcp-server",
      version: "0.1.0"
    }, {
    capabilities: {
      resources: {},
        tools: {}
      }
    });
    
    this.setupHandlers();
    this.setupErrorHandling();
    this.connectToMgb();
  }
  
  // WebSocketクライアントへの接続
  private connectToMgb(): void {
    console.error("[MGB MCP] Connecting to mGB MIDI sequencer at", WS_URL);
    
    // 既存の接続がある場合は閉じる
    if (wsClient) {
      try {
        wsClient.terminate();
      } catch (e) {
        // エラーは無視
      }
    }
    
    wsClient = new WebSocket(WS_URL);
    
    wsClient.on("open", () => {
      console.error("[MGB MCP] Connected to mGB MIDI sequencer");
      isConnected = true;
      
      // 初期状態を取得
      this.sendCommand({ command: "get_state" })
        .then(response => {
          if (response.status === "error") {
            console.error("[MGB MCP] Failed to get initial state:", response.message);
          } else {
            console.error("[MGB MCP] Initial state retrieved successfully");
          }
        })
        .catch(error => {
          console.error("[MGB MCP] Error getting initial state:", error);
        });
    });
    
    wsClient.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "state") {
          currentState = message as MgbState;
          console.error("[MGB MCP] State updated");
        } else if (message.type === "response") {
          const response = message as WsResponse;
          if (response.status === "error") {
            console.error(`[MGB API Error] ${response.message}`);
          } else {
            console.error(`[MGB API] Response received: ${JSON.stringify(response.data || {})}`);
          }
        } else if (message.type === "cc_update") {
          // CC更新通知の処理
          console.error(`[MGB MCP] CC update received: ${message.track} ${message.cc} = ${message.value}`);
          
          // 現在の状態が利用可能であれば更新
          if (currentState && currentState.cc_values) {
            if (!currentState.cc_values[message.track]) {
              currentState.cc_values[message.track] = {};
            }
            
            // ccが数値の場合、文字列形式に変換
            const ccKey = typeof message.cc === 'number' ? `cc${message.cc}` : message.cc;
            currentState.cc_values[message.track][ccKey] = message.value;
          }
        }
      } catch (error) {
        console.error("[MGB MCP] Error parsing WebSocket message", error);
      }
    });
    
    wsClient.on("error", (error) => {
      console.error("[MGB MCP] WebSocket error:", error);
      isConnected = false;
    });
    
    wsClient.on("close", () => {
      console.error("[MGB MCP] WebSocket connection closed");
      isConnected = false;
      
      // 再接続を試みる（多少ランダム化して5〜8秒後）
      const reconnectDelay = 5000 + Math.floor(Math.random() * 3000);
      console.error(`[MGB MCP] Will reconnect in ${reconnectDelay/1000} seconds`);
      
      setTimeout(() => {
        this.connectToMgb();
      }, reconnectDelay);
    });
  }
  
  // WebSocketコマンドの送信
  private sendCommand(command: WsCommand): Promise<WsResponse> {
    return new Promise((resolve) => {
      if (!isConnected || !wsClient) {
        const errorResponse: WsResponse = {
          type: "response",
          status: "error",
          message: "Not connected to mGB MIDI sequencer"
        };
        resolve(errorResponse);
        return;
      }
      
      try {
        console.error(`[MGB MCP] Sending command: ${JSON.stringify(command)}`);
        wsClient.send(JSON.stringify(command));
        
        // 即座に成功レスポンスを返す
        const successResponse: WsResponse = {
          type: "response",
          status: "success",
          data: { command: command.command },
          message: undefined
        };
        resolve(successResponse);
      } catch (e) {
        console.error(`[MGB MCP] Error sending command:`, e);
        resolve({
          type: "response",
          status: "error",
          message: `Error sending command: ${e instanceof Error ? e.message : String(e)}`
        });
      }
    });
  }
  
  // エラーハンドリングのセットアップ
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };
    
    process.on("SIGINT", async () => {
      if (wsClient) {
        wsClient.close();
      }
      await this.server.close();
      process.exit(0);
    });
  }
  
  // ハンドラーのセットアップ
  private setupHandlers(): void {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }
  
  // リソースハンドラーのセットアップ
  private setupResourceHandlers(): void {
    // 利用可能なリソース一覧の取得
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      async () => ({
        resources: [{
          uri: "mgb://state",
          name: "mGB MIDI Sequencer State",
          mimeType: "application/json",
          description: "Current state of the mGB MIDI sequencer including patterns, BPM, and settings"
        }]
      })
    );
    
    // 特定のリソースの取得
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        if (request.params.uri !== "mgb://state") {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
        }
        
        if (!currentState) {
          // 状態が取得されていない場合は取得を試みる
          try {
            const response = await this.sendCommand({ command: "get_state" });
            
            // 接続エラーの場合はダミーの状態を返す
            if (response.status === "error") {
              return {
                contents: [{
                  uri: request.params.uri,
                  mimeType: "application/json",
                  text: JSON.stringify({
                    is_playing: false,
                    bpm: 120,
                    current_step: 0,
                    sequence: [],
                    note_values: [],
                    midi_output: "",
                    midi_input: "",
                    midi_clock_enabled: false,
                    cc_values: {},
                    _error: response.message || "Failed to connect to mGB MIDI sequencer"
                  }, null, 2)
                }]
              };
            }
          } catch (error) {
            // エラーをキャッチしてもダミーデータを返す
            return {
              contents: [{
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  is_playing: false,
                  bpm: 120,
                  current_step: 0,
                  sequence: [],
                  note_values: [],
                  midi_output: "",
                  midi_input: "",
                  midi_clock_enabled: false,
                  cc_values: {},
                  _error: error instanceof Error ? error.message : "Unknown error"
                }, null, 2)
              }]
            };
          }
          
          // 状態がまだない場合もダミーデータを返す
          if (!currentState) {
  return {
    contents: [{
      uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  is_playing: false,
                  bpm: 120,
                  current_step: 0,
                  sequence: [],
                  note_values: [],
                  midi_output: "",
                  midi_input: "",
                  midi_clock_enabled: false,
                  cc_values: {},
                  _error: "mGB state is not available"
                }, null, 2)
              }]
            };
          }
        }
        
  return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(currentState, null, 2)
          }]
        };
      }
    );
  }
  
  // ツールハンドラーのセットアップ
  private setupToolHandlers(): void {
    // 利用可能なツール一覧の取得
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
    tools: [
      {
            name: "toggle_play",
            description: "Start or stop the sequencer playback",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "set_bpm",
            description: "Set the tempo (BPM) of the sequencer",
            inputSchema: {
              type: "object",
              properties: {
                bpm: {
                  type: "number",
                  description: "Tempo in beats per minute (BPM)",
                  minimum: 60,
                  maximum: 300
                }
              },
              required: ["bpm"]
            }
          },
          {
            name: "toggle_step",
            description: "Toggle a step in the sequencer pattern on or off",
            inputSchema: {
              type: "object",
              properties: {
                row: {
                  type: "number",
                  description: "Row index (track)"
                },
                col: {
                  type: "number",
                  description: "Column index (step)"
                }
              },
              required: ["row", "col"]
            }
          },
          {
            name: "set_note",
            description: "Set a note value for a step in the sequencer",
            inputSchema: {
              type: "object",
              properties: {
                row: {
                  type: "number",
                  description: "Row index (track)"
                },
                col: {
                  type: "number",
                  description: "Column index (step)"
                },
                note: {
                  type: "number",
                  description: "MIDI note value (0-127)",
                  minimum: 0,
                  maximum: 127
                },
                divide: {
                  type: "number",
                  description: "Note division setting: 1=normal, 2=duplet, 3=triplet",
                  enum: [1, 2, 3]
                }
              },
              required: ["row", "col", "note"]
            }
          },
          {
            name: "send_preset",
            description: "Send a preset pattern to the sequencer",
            inputSchema: {
              type: "object",
              properties: {
                preset: {
                  type: "string",
                  description: "Preset name"
                }
              },
              required: ["preset"]
            }
          },
          {
            name: "batch_update",
            description: "Update sequencer patterns and notes in batch",
            inputSchema: {
              type: "object",
              properties: {
                updates: {
                  type: "array",
                  description: "Array of updates to apply",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        description: "Type of update",
                        enum: ["sequence", "note", "divide", "sequence_row", "note_row", "divide_row", "sequence_all", "note_all", "divide_all"]
                      },
                      row: {
                        type: "number",
                        description: "Row index (track) for updates"
                      },
                      col: {
                        type: "number",
                        description: "Column index (step) for individual updates"
                      },
                      state: {
                        type: "boolean",
                        description: "State for individual sequence updates"
                      },
                      note: {
                        type: "number",
                        description: "Note value for individual note updates",
                        minimum: 0,
                        maximum: 127
                      },
                      divide: {
                        type: "number",
                        description: "Note division setting: 1=normal, 2=duplet, 3=triplet",
                        enum: [1, 2, 3]
                      },
                      states: {
                        description: "Array of boolean states for sequence updates",
                        oneOf: [
                          {
                            type: "array",
                            items: {
                              type: "boolean"
                            }
                          },
                          {
                            type: "array",
                            items: {
                              type: "array",
                              items: {
                                type: "boolean"
                              }
                            }
                          }
                        ]
                      },
                      notes: {
                        description: "Array of note values for note updates",
                        oneOf: [
                          {
                            type: "array",
                            items: {
                              type: "number",
                              minimum: 0,
                              maximum: 127
                            }
                          },
                          {
                            type: "array",
                            items: {
                              type: "array",
                              items: {
                                type: "number",
                                minimum: 0,
                                maximum: 127
                              }
                            }
                          }
                        ]
                      },
                      divides: {
                        description: "Array of note division settings",
                        oneOf: [
                          {
                            type: "array",
                            items: {
                              type: "number",
                              enum: [1, 2, 3]
                            }
                          },
                          {
                            type: "array",
                            items: {
                              type: "array",
                              items: {
                                type: "number",
                                enum: [1, 2, 3]
                              }
                            }
                          }
                        ]
                      }
                    },
                    required: ["type"]
                  }
                }
              },
              required: ["updates"]
            }
          },
          {
            name: "get_midi_ports",
            description: "Get available MIDI input and output ports",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "change_midi_output",
            description: "Change the MIDI output port",
            inputSchema: {
              type: "object",
              properties: {
                port: {
                  type: "string",
                  description: "MIDI output port name"
                }
              },
              required: ["port"]
            }
          },
          {
            name: "change_midi_input",
            description: "Change the MIDI input port",
            inputSchema: {
              type: "object",
              properties: {
                port: {
                  type: "string",
                  description: "MIDI input port name"
                }
              },
              required: ["port"]
            }
          },
          {
            name: "toggle_midi_clock",
            description: "Enable or disable MIDI clock transmission",
            inputSchema: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  description: "Whether to enable MIDI clock"
                }
              },
              required: ["enabled"]
            }
          },
          {
            name: "update_cc",
            description: "Update a control change value for a track (NOTE: Does not return a direct response to the sender)",
            inputSchema: {
              type: "object",
              properties: {
                track: {
                  type: "string",
                  description: "Track name (PU1, PU2, WAV, NOISE, POLY)",
                  enum: ["PU1", "PU2", "WAV", "NOISE", "POLY"]
                },
                cc: {
                  description: "Control change parameter name or number",
                  oneOf: [
                    {
                      type: "string",
                      description: "CC name in format 'cc1', 'cc2', etc."
                    },
                    {
                      type: "number",
                      description: "CC number (0-127)",
                      minimum: 0,
                      maximum: 127
                    }
                  ]
                },
                value: {
                  type: "number",
                  description: "Parameter value (0-127)",
                  minimum: 0,
                  maximum: 127
                }
              },
              required: ["track", "cc", "value"]
            }
          }
        ]
      })
    );
    
    // ツールの呼び出し
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        try {
          switch (request.params.name) {
            case "toggle_play": {
              const response = await this.sendCommand({ command: "toggle_play" });
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `Playback ${response.data?.is_playing ? "started" : "stopped"}`
                }]
              };
            }
            
            case "set_bpm": {
              if (!isSetBpmArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid BPM arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "set_bpm",
                bpm: request.params.arguments.bpm
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `BPM set to ${response.data?.bpm}`
                }]
              };
            }
            
            case "toggle_step": {
              if (!isToggleStepArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid toggle step arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "toggle_step",
                row: request.params.arguments.row,
                col: request.params.arguments.col
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `Step [${response.data?.row}, ${response.data?.col}] set to ${response.data?.value ? "ON" : "OFF"}`
                }]
              };
            }
            
            case "set_note": {
              if (!isSetNoteArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid set note arguments"
                );
              }
              
              const command: any = {
                command: "set_note",
                row: request.params.arguments.row,
                col: request.params.arguments.col,
                note: request.params.arguments.note
              };
              
              // divideが指定されていれば追加
              if (request.params.arguments.divide !== undefined) {
                command.divide = request.params.arguments.divide;
              }
              
              const response = await this.sendCommand(command);
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              let responseText = `Note at [${response.data?.row}, ${response.data?.col}] set to ${response.data?.note}`;
              if (response.data?.divide) {
                responseText += ` with division ${response.data.divide}`;
              }
              
              return {
                content: [{
                  type: "text",
                  text: responseText
                }]
              };
            }
            
            case "send_preset": {
              if (!isSendPresetArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid preset arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "send_preset",
                preset: request.params.arguments.preset
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `Preset "${response.data?.preset}" applied successfully`
                }]
              };
            }
            
            case "batch_update": {
              if (!isBatchUpdateArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid batch update arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "batch_update",
                updates: request.params.arguments.updates
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: "Batch update completed successfully"
                }]
              };
            }
            
            case "get_midi_ports": {
              const response = await this.sendCommand({
                command: "get_available_ports"
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }

              return {
                content: [{
                  type: "text",
                  text: JSON.stringify(response.data, null, 2)
                }]
              };
            }

            case "change_midi_output": {
              if (!isChangeMidiOutputArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid MIDI output arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "change_midi_output",
                port: request.params.arguments.port
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `MIDI output changed to ${response.data?.port}`
                }]
              };
            }
            
            case "change_midi_input": {
              if (!isChangeMidiInputArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid MIDI input arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "change_midi_input",
                port: request.params.arguments.port
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `MIDI input changed to ${response.data?.port}`
                }]
              };
            }
            
            case "toggle_midi_clock": {
              if (!isToggleMidiClockArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid MIDI clock arguments"
                );
              }
              
              const response = await this.sendCommand({
                command: "toggle_midi_clock",
                enabled: request.params.arguments.enabled
              });
              
              if (response.status === "error") {
                return {
                  content: [{
                    type: "text",
                    text: `Error: ${response.message || "Unknown error"}`
                  }]
                };
              }
              
              return {
                content: [{
                  type: "text",
                  text: `MIDI clock ${response.data?.midi_clock_enabled ? "enabled" : "disabled"}`
                }]
              };
            }
            
            case "update_cc": {
              if (!isUpdateCcArgs(request.params.arguments)) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  "Invalid control change arguments"
                );
              }
              
              // update_ccは特別処理が必要：
              // - レスポンスを待たずに送信
              // - 即時の成功レスポンスを返す
              
              // 先にコマンドを送信
              this.sendCommand({
                command: "update_cc",
                track: request.params.arguments.track,
                cc: request.params.arguments.cc,
                value: request.params.arguments.value
              }).catch(error => {
                console.error("[MGB MCP] Error sending update_cc command:", error);
              });
              
              // 即時にレスポンスを返す
              return {
                content: [{
                  type: "text",
                  text: `CC update sent for ${request.params.arguments.track} ${request.params.arguments.cc} = ${request.params.arguments.value}`
                }]
              };
            }
            
            case "update_synth_param": {
              const args = request.params.arguments as {
                track: string;
                param: string;
                value: number;
              };
              
              // update_ccは特別処理が必要：
              // - レスポンスを待たずに送信
              // - 即時の成功レスポンスを返す
              
              // 先にコマンドを送信（互換性のためにupdate_ccにマッピング）
              this.sendCommand({
                command: "update_cc",
                track: args.track,
                cc: args.param,
                value: args.value
              }).catch(error => {
                console.error("[MGB MCP] Error sending update_cc command:", error);
              });
              
              // 即時にレスポンスを返す
              return {
                content: [{
                  type: "text",
                  text: `Synth parameter update sent for ${args.track} ${args.param} = ${args.value}`
                }]
              };
            }
            
            default:
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${request.params.name}`
              );
          }
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          
          throw new McpError(
            ErrorCode.InternalError,
            `Error calling mGB API: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    );
  }
  
  // サーバーの実行
  async run(): Promise<void> {
  const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("mGB MCP server running on stdio");
  }
}

// サーバーの実行
const server = new MgbServer();
server.run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
