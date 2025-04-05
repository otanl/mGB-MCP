// MGB MIDI シーケンサーの状態を表す型
export interface MgbState {
  type: "state";
  is_playing: boolean;
  bpm: number;
  current_step: number;
  sequence: boolean[][];
  note_values: number[][];
  midi_output: string;
  midi_input: string;
  midi_clock_enabled: boolean;
  cc_values: {
    [track: string]: {
      [cc: string]: number;
    }
  };
}

// WebSocketレスポンスの基本型
export interface WsResponse {
  type: "response";
  status: "success" | "error";
  data?: any;
  message?: string;
}

// CC更新通知の型
export interface CcUpdateNotification {
  type: "cc_update";
  track: string;
  cc: string | number;
  value: number;
}

// WebSocketコマンドリクエストの基本型
export interface WsCommand {
  command: string;
  [key: string]: any;
}

// 引数定義
export interface GetStateArgs {
  // 引数なし
}

export interface TogglePlayArgs {
  // 引数なし
}

export interface SetBpmArgs {
  bpm: number;
}

export interface ToggleStepArgs {
  row: number;
  col: number;
}

export interface SetNoteArgs {
  row: number;
  col: number;
  note: number;
  divide?: 1 | 2 | 3; // 分割設定: 1=通常, 2=2連符, 3=3連符
}

export interface SendPresetArgs {
  preset: string;
}

export interface GetAvailablePortsArgs {
  // 引数なし
}

export interface ChangeMidiOutputArgs {
  port: string;
}

export interface ChangeMidiInputArgs {
  port: string;
}

export interface ToggleMidiClockArgs {
  enabled: boolean;
}

export interface UpdateCcArgs {
  track: string;
  cc: string | number;
  value: number;
}

// 個別更新の型定義
export interface SequenceUpdate {
  type: "sequence";
  row: number;
  col: number;
  state: boolean;
}

export interface NoteUpdate {
  type: "note";
  row: number;
  col: number;
  note: number;
}

export interface DivideUpdate {
  type: "divide";
  row: number;
  col: number;
  divide: 1 | 2 | 3;
}

// 行更新の型定義
export interface SequenceRowUpdate {
  type: "sequence_row";
  row: number;
  states: boolean[];
}

export interface NoteRowUpdate {
  type: "note_row";
  row: number;
  notes: number[];
}

export interface DivideRowUpdate {
  type: "divide_row";
  row: number;
  divides: (1 | 2 | 3)[];
}

// 全体更新の型定義
export interface SequenceAllUpdate {
  type: "sequence_all";
  states: boolean[][];
}

export interface NoteAllUpdate {
  type: "note_all";
  notes: number[][];
}

export interface DivideAllUpdate {
  type: "divide_all";
  divides: (1 | 2 | 3)[][];
}

// バッチ更新で使用できる全ての更新の型
export type BatchUpdate = 
  SequenceUpdate | 
  NoteUpdate | 
  DivideUpdate | 
  SequenceRowUpdate | 
  NoteRowUpdate | 
  DivideRowUpdate | 
  SequenceAllUpdate | 
  NoteAllUpdate | 
  DivideAllUpdate;

export interface BatchUpdateCommand {
  command: "batch_update";
  updates: BatchUpdate[];
}

// 型チェック用関数
export function isSetBpmArgs(args: any): args is SetBpmArgs {
  return typeof args.bpm === "number" && args.bpm >= 60 && args.bpm <= 300;
}

export function isToggleStepArgs(args: any): args is ToggleStepArgs {
  return typeof args.row === "number" && typeof args.col === "number";
}

export function isSetNoteArgs(args: any): args is SetNoteArgs {
  const validDivide = args.divide === undefined || [1, 2, 3].includes(args.divide);
  return typeof args.row === "number" && 
         typeof args.col === "number" && 
         typeof args.note === "number" &&
         args.note >= 0 && args.note <= 127 &&
         validDivide;
}

export function isBatchUpdateArgs(args: any): args is { updates: BatchUpdate[] } {
  if (!Array.isArray(args.updates)) return false;
  
  return args.updates.every((update: any) => {
    const validTypes = [
      "sequence", "note", "divide", 
      "sequence_row", "note_row", "divide_row", 
      "sequence_all", "note_all", "divide_all"
    ];
    if (!validTypes.includes(update.type)) return false;
    
    switch (update.type) {
      case "sequence":
        return typeof update.row === "number" && 
               typeof update.col === "number" && 
               typeof update.state === "boolean";
      case "note":
        return typeof update.row === "number" && 
               typeof update.col === "number" && 
               typeof update.note === "number" &&
               update.note >= 0 && update.note <= 127;
      case "divide":
        return typeof update.row === "number" && 
               typeof update.col === "number" && 
               [1, 2, 3].includes(update.divide);
      case "sequence_row":
        return typeof update.row === "number" && 
               Array.isArray(update.states) &&
               update.states.every((s: any) => typeof s === "boolean");
      case "note_row":
        return typeof update.row === "number" && 
               Array.isArray(update.notes) &&
               update.notes.every((n: any) => typeof n === "number" && n >= 0 && n <= 127);
      case "divide_row":
        return typeof update.row === "number" && 
               Array.isArray(update.divides) &&
               update.divides.every((d: any) => [1, 2, 3].includes(d));
      case "sequence_all":
        return Array.isArray(update.states) &&
               update.states.every((row: any) => 
                 Array.isArray(row) && row.every((s: any) => typeof s === "boolean"));
      case "note_all":
        return Array.isArray(update.notes) &&
               update.notes.every((row: any) => 
                 Array.isArray(row) && row.every((n: any) => typeof n === "number" && n >= 0 && n <= 127));
      case "divide_all":
        return Array.isArray(update.divides) &&
               update.divides.every((row: any) => 
                 Array.isArray(row) && row.every((d: any) => [1, 2, 3].includes(d)));
      default:
        return false;
    }
  });
}

export function isSendPresetArgs(args: any): args is SendPresetArgs {
  return typeof args.preset === "string";
}

export function isChangeMidiOutputArgs(args: any): args is ChangeMidiOutputArgs {
  return typeof args.port === "string";
}

export function isChangeMidiInputArgs(args: any): args is ChangeMidiInputArgs {
  return typeof args.port === "string";
}

export function isToggleMidiClockArgs(args: any): args is ToggleMidiClockArgs {
  return typeof args.enabled === "boolean";
}

export function isUpdateCcArgs(args: any): args is UpdateCcArgs {
  const validTracks = ["PU1", "PU2", "WAV", "NOISE", "POLY"];
  
  // CC番号の検証（文字列形式または数値形式）
  const isValidCC = (cc: any): boolean => {
    if (typeof cc === "string") {
      // 文字列形式（"cc1", "cc2"など）
      return /^cc\d+$/.test(cc);
    } else if (typeof cc === "number") {
      // 数値形式（1, 2など）
      return cc >= 0 && cc <= 127;
    }
    return false;
  };
  
  return validTracks.includes(args.track) &&
         isValidCC(args.cc) &&
         typeof args.value === "number" &&
         args.value >= 0 && args.value <= 127;
} 