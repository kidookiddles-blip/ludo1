export type PlayerColor = "ruby" | "sapphire" | "emerald" | "sun";
export type MatchStatus = "lobby" | "playing" | "complete";
export type AiDifficulty = "easy" | "medium" | "hard" | "expert";

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: PlayerColor;
  connected: boolean;
  ready: boolean;
  host: boolean;
  ai?: boolean;
  rank: number;
  stats: { wins: number; games: number };
}

export interface TokenState {
  id: number;
  progress: number;
}

export interface PlayerBoard {
  playerId: string;
  color: PlayerColor;
  tokens: TokenState[];
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export interface MoveEvent {
  id: string;
  text: string;
  at: number;
}

export interface RoomState {
  code: string;
  name: string;
  isPrivate: boolean;
  maxPlayers: 2 | 3 | 4;
  status: MatchStatus;
  hostId: string;
  players: Player[];
  boards: PlayerBoard[];
  spectators: Player[];
  currentTurn: number;
  dice: number | null;
  consecutiveSixes: number;
  turnEndsAt: number | null;
  winnerIds: string[];
  chat: ChatMessage[];
  history: MoveEvent[];
  createdAt: number;
}

export interface ServerToClientEvents {
  roomState: (state: RoomState) => void;
  roomClosed: (payload: { code: string; reason: string }) => void;
  toast: (payload: { title: string; body?: string; kind?: "info" | "success" | "danger" }) => void;
  diceRolled: (payload: { playerId: string; value: number }) => void;
  capture: (payload: { by: string; victim: string; cell: number }) => void;
}

export interface ClientToServerEvents {
  createRoom: (payload: CreateRoomPayload, ack: Ack<{ room: RoomState; playerId: string }>) => void;
  joinRoom: (payload: JoinRoomPayload, ack: Ack<{ room: RoomState; playerId: string }>) => void;
  rejoinRoom: (payload: { code: string; playerId: string }, ack: Ack<{ room: RoomState; playerId: string }>) => void;
  leaveRoom: (ack?: Ack<{ closed: boolean; room?: RoomState }>) => void;
  setReady: (payload: { ready: boolean }) => void;
  addAi: (payload: { difficulty: AiDifficulty }) => void;
  startMatch: () => void;
  rollDice: () => void;
  moveToken: (payload: { tokenId: number }) => void;
  sendChat: (payload: { text: string }) => void;
}

export type Ack<T> = (response: { ok: true } & T | { ok: false; error: string }) => void;

export interface CreateRoomPayload {
  name: string;
  playerName: string;
  avatar: string;
  maxPlayers: 2 | 3 | 4;
  isPrivate: boolean;
  password?: string;
}

export interface JoinRoomPayload {
  code: string;
  playerName: string;
  avatar: string;
  password?: string;
  spectator?: boolean;
}

export const COLORS: PlayerColor[] = ["ruby", "sapphire", "emerald", "sun"];

export const OUTER_TRACK_LAST_PROGRESS = 50;
export const HOME_LANE_START_PROGRESS = 51;
export const HOME_FINISH_PROGRESS = 56;

export const COLOR_META: Record<PlayerColor, { label: string; hex: string; start: number; safe: number[] }> = {
  emerald: { label: "Emerald", hex: "#20c87a", start: 0, safe: [0, 8] },
  sun: { label: "Sun", hex: "#ffc742", start: 13, safe: [13, 21] },
  sapphire: { label: "Sapphire", hex: "#3485ff", start: 26, safe: [26, 34] },
  ruby: { label: "Ruby", hex: "#ff3b5f", start: 39, safe: [39, 47] }
};

export const GLOBAL_SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
