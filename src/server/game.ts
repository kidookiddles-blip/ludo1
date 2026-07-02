import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  AiDifficulty,
  ChatMessage,
  COLORS,
  COLOR_META,
  CreateRoomPayload,
  GLOBAL_SAFE_CELLS,
  HOME_FINISH_PROGRESS,
  HOME_LANE_START_PROGRESS,
  JoinRoomPayload,
  MoveEvent,
  OUTER_TRACK_LAST_PROGRESS,
  Player,
  PlayerBoard,
  RoomState,
  TokenState
} from "../shared/types.js";

const TURN_MS = 30_000;
const TOKEN_COUNT = 4;
const COMPLETED_ROOM_TTL_MS = 1_000;
const EMPTY_ROOM_TTL_MS = 90_000;

const createRoomSchema = z.object({
  name: z.string().trim().min(2).max(32),
  playerName: z.string().trim().min(2).max(20),
  avatar: z.string().trim().min(1).max(8),
  maxPlayers: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  isPrivate: z.boolean(),
  password: z.string().max(64).optional()
});

const joinRoomSchema = z.object({
  code: z.string().trim().min(6).max(8),
  playerName: z.string().trim().min(2).max(20),
  avatar: z.string().trim().min(1).max(8),
  password: z.string().max(64).optional(),
  spectator: z.boolean().optional()
});

interface InternalRoom {
  state: RoomState;
  passwordHash?: string;
  completedAt?: number;
  emptySince?: number;
}

export class GameService {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketPlayers = new Map<string, { roomCode: string; playerId: string }>();

  createRoom(payload: CreateRoomPayload, socketId: string) {
    const parsed = createRoomSchema.parse(payload);
    const playerId = randomUUID();
    const code = this.generateCode();
    const player = this.makePlayer(playerId, parsed.playerName, parsed.avatar, COLORS[0], true);
    const state: RoomState = {
      code,
      name: parsed.name,
      isPrivate: parsed.isPrivate,
      maxPlayers: parsed.maxPlayers,
      status: "lobby",
      hostId: playerId,
      players: [player],
      boards: [],
      spectators: [],
      currentTurn: 0,
      dice: null,
      consecutiveSixes: 0,
      turnEndsAt: null,
      winnerIds: [],
      chat: [],
      history: [this.event(`${player.name} opened room ${code}`)],
      createdAt: Date.now()
    };
    this.rooms.set(code, {
      state,
      passwordHash: parsed.password ? bcrypt.hashSync(parsed.password, 10) : undefined
    });
    this.socketPlayers.set(socketId, { roomCode: code, playerId });
    return { room: state, playerId };
  }

  joinRoom(payload: JoinRoomPayload, socketId: string) {
    const parsed = joinRoomSchema.parse({ ...payload, code: payload.code.toUpperCase() });
    const room = this.mustGet(parsed.code);
    if (room.passwordHash && !bcrypt.compareSync(parsed.password ?? "", room.passwordHash)) {
      throw new Error("Room password is incorrect.");
    }
    const playerId = randomUUID();
    if (parsed.spectator || room.state.status !== "lobby" || room.state.players.length >= room.state.maxPlayers) {
      const spectator = this.makePlayer(playerId, parsed.playerName, parsed.avatar, "ruby", false);
      room.state.spectators.push({ ...spectator, color: COLORS[room.state.spectators.length % COLORS.length] });
      room.state.history.unshift(this.event(`${parsed.playerName} joined as spectator`));
      this.socketPlayers.set(socketId, { roomCode: room.state.code, playerId });
      room.emptySince = undefined;
      return { room: room.state, playerId };
    }
    const color = COLORS[room.state.players.length];
    const player = this.makePlayer(playerId, parsed.playerName, parsed.avatar, color, false);
    room.state.players.push(player);
    room.state.history.unshift(this.event(`${player.name} joined the lobby`));
    this.socketPlayers.set(socketId, { roomCode: room.state.code, playerId });
    room.emptySince = undefined;
    return { room: room.state, playerId };
  }

  rejoinRoom(code: string, playerId: string, socketId: string) {
    const room = this.mustGet(code.toUpperCase());
    const player = [...room.state.players, ...room.state.spectators].find((p) => p.id === playerId);
    if (!player) throw new Error("No saved seat exists for this room.");
    player.connected = true;
    this.socketPlayers.set(socketId, { roomCode: room.state.code, playerId });
    room.emptySince = undefined;
    room.state.history.unshift(this.event(`${player.name} reconnected`));
    return { room: room.state, playerId };
  }

  disconnect(socketId: string) {
    const link = this.socketPlayers.get(socketId);
    if (!link) return undefined;
    this.socketPlayers.delete(socketId);
    const room = this.rooms.get(link.roomCode);
    const player = room?.state.players.find((p) => p.id === link.playerId) ?? room?.state.spectators.find((p) => p.id === link.playerId);
    if (player && !player.ai) {
      player.connected = false;
      room?.state.history.unshift(this.event(`${player.name} lost connection`));
    }
    if (room) this.markEmptyIfNeeded(room);
    return room?.state;
  }

  leaveRoom(socketId: string) {
    const link = this.socketPlayers.get(socketId);
    if (!link) throw new Error("Join a room first.");
    const room = this.rooms.get(link.roomCode);
    if (!room) {
      this.socketPlayers.delete(socketId);
      return { closed: true as const };
    }

    const player = room.state.players.find((p) => p.id === link.playerId);
    const spectator = room.state.spectators.find((p) => p.id === link.playerId);
    if (!player && !spectator) {
      this.socketPlayers.delete(socketId);
      return { closed: false as const, room: room.state };
    }

    const leavingName = player?.name ?? spectator?.name ?? "A player";
    const leavingTurnIndex = player ? room.state.players.findIndex((p) => p.id === link.playerId) : -1;
    const wasCurrentTurn = room.state.status === "playing" && leavingTurnIndex === room.state.currentTurn;
    room.state.players = room.state.players.filter((p) => p.id !== link.playerId);
    room.state.spectators = room.state.spectators.filter((p) => p.id !== link.playerId);
    room.state.boards = room.state.boards.filter((board) => board.playerId !== link.playerId);
    room.state.winnerIds = room.state.winnerIds.filter((id) => id !== link.playerId);
    this.socketPlayers.delete(socketId);

    if (room.state.players.length === 0) {
      this.deleteRoom(room.state.code);
      return { closed: true as const };
    }

    if (player?.host && room.state.players.length > 0) {
      room.state.players[0].host = true;
      room.state.hostId = room.state.players[0].id;
      room.state.history.unshift(this.event(`${room.state.players[0].name} is now host`));
    }

    if (room.state.status === "playing") {
      if (room.state.players.length < 2) {
        room.state.status = "complete";
        room.state.turnEndsAt = null;
        room.completedAt = Date.now();
      } else {
        if (wasCurrentTurn) {
          room.state.currentTurn = (leavingTurnIndex - 1 + room.state.players.length) % room.state.players.length;
          this.advanceTurn(room.state);
        } else if (leavingTurnIndex >= 0 && leavingTurnIndex < room.state.currentTurn) {
          room.state.currentTurn -= 1;
        } else {
          room.state.currentTurn = Math.min(room.state.currentTurn, room.state.players.length - 1);
        }
      }
    }

    room.state.history.unshift(this.event(`${leavingName} left the room`));
    this.markEmptyIfNeeded(room);
    return { closed: false as const, room: room.state };
  }

  setReady(socketId: string, ready: boolean) {
    const { room, player } = this.context(socketId);
    if (room.state.status !== "lobby") return room.state;
    player.ready = ready;
    room.state.history.unshift(this.event(`${player.name} is ${ready ? "ready" : "not ready"}`));
    return room.state;
  }

  addAi(socketId: string, difficulty: AiDifficulty) {
    const { room, player } = this.context(socketId);
    if (!player.host) throw new Error("Only the host can add AI players.");
    if (room.state.status !== "lobby") throw new Error("AI players can only be added in the lobby.");
    if (room.state.players.length >= room.state.maxPlayers) throw new Error("Room is full.");
    const color = COLORS[room.state.players.length];
    const ai = this.makePlayer(`ai-${randomUUID()}`, `${difficulty[0].toUpperCase()}${difficulty.slice(1)} AI`, "🤖", color, false);
    ai.ai = true;
    ai.ready = true;
    room.state.players.push(ai);
    room.state.history.unshift(this.event(`${ai.name} took a seat`));
    return room.state;
  }

  startMatch(socketId: string) {
    const { room, player } = this.context(socketId);
    if (!player.host) throw new Error("Only the host can start.");
    if (room.state.players.length < 2) throw new Error("At least two players are required.");
    if (room.state.players.some((p) => !p.ready && !p.host)) throw new Error("All players must be ready.");
    room.state.status = "playing";
    room.state.boards = room.state.players.map((p) => ({
      playerId: p.id,
      color: p.color,
      tokens: Array.from({ length: TOKEN_COUNT }, (_, id) => ({ id, progress: -1 }))
    }));
    room.state.currentTurn = 0;
    room.state.dice = null;
    room.state.consecutiveSixes = 0;
    room.state.turnEndsAt = Date.now() + TURN_MS;
    room.state.history.unshift(this.event("The match has begun"));
    return room.state;
  }

  rollDice(socketId: string) {
    const { room, player } = this.context(socketId);
    this.assertTurn(room.state, player.id);
    if (room.state.dice) throw new Error("Move a token before rolling again.");
    const playerId = player.id;
    const dice = 1 + Math.floor(Math.random() * 6);
    room.state.dice = dice;
    room.state.consecutiveSixes = dice === 6 ? room.state.consecutiveSixes + 1 : 0;
    room.state.history.unshift(this.event(`${player.name} rolled ${dice}`));
    if (room.state.consecutiveSixes >= 3) {
      room.state.history.unshift(this.event(`${player.name} rolled three sixes and lost the turn`));
      this.advanceTurn(room.state);
    } else if (this.legalMoves(room.state).length === 0) {
      room.state.history.unshift(this.event(`${player.name} had no legal moves`));
      this.advanceTurn(room.state);
    } else {
      room.state.turnEndsAt = Date.now() + TURN_MS;
    }
    return { state: room.state, dice, playerId };
  }

  moveToken(socketId: string, tokenId: number) {
    const { room, player } = this.context(socketId);
    return this.applyMove(room.state, player.id, tokenId);
  }

  sendChat(socketId: string, text: string) {
    const { room, player } = this.context(socketId);
    const clean = text.trim().slice(0, 160);
    if (!clean) return room.state;
    const message: ChatMessage = { id: randomUUID(), playerId: player.id, name: player.name, text: clean, at: Date.now() };
    room.state.chat = [message, ...room.state.chat].slice(0, 40);
    return room.state;
  }

  tick() {
    const changed: RoomState[] = [];
    for (const room of this.rooms.values()) {
      const state = room.state;
      if (state.status === "playing" && state.turnEndsAt && Date.now() > state.turnEndsAt) {
        const player = state.players[state.currentTurn];
        state.history.unshift(this.event(`${player.name} timed out`));
        this.advanceTurn(state);
        changed.push(state);
      }
    }
    return changed;
  }

  getAiAction(state: RoomState) {
    if (state.status !== "playing") return null;
    const player = state.players[state.currentTurn];
    if (!player?.ai) return null;
    if (!state.dice) return { kind: "roll" as const };
    const legal = this.legalMoves(state);
    if (!legal.length) return null;
    const best = legal.sort((a, b) => this.scoreMove(state, b) - this.scoreMove(state, a))[0];
    return { kind: "move" as const, tokenId: best.token.id };
  }

  applyAiRoll(state: RoomState) {
    const room = this.rooms.get(state.code);
    if (!room) throw new Error("Room vanished.");
    const player = state.players[state.currentTurn];
    const playerId = player.id;
    const dice = 1 + Math.floor(Math.random() * 6);
    state.dice = dice;
    state.consecutiveSixes = dice === 6 ? state.consecutiveSixes + 1 : 0;
    state.history.unshift(this.event(`${player.name} rolled ${dice}`));
    if (state.consecutiveSixes >= 3 || this.legalMoves(state).length === 0) this.advanceTurn(state);
    return { state, dice, playerId };
  }

  applyMove(state: RoomState, playerId: string, tokenId: number) {
    this.assertTurn(state, playerId);
    if (!state.dice) throw new Error("Roll the dice first.");
    const board = this.currentBoard(state);
    const token = board.tokens.find((t) => t.id === tokenId);
    if (!token) throw new Error("Token does not exist.");
    if (!this.isLegalProgress(token.progress, state.dice)) throw new Error("That move is not legal.");
    token.progress = token.progress === -1 ? 0 : token.progress + state.dice;
    let capture: { by: string; victim: string; cell: number } | undefined;
    if (token.progress <= OUTER_TRACK_LAST_PROGRESS) {
      const cell = this.absoluteCell(board.color, token.progress);
      if (!GLOBAL_SAFE_CELLS.has(cell)) {
        for (const enemy of state.boards.filter((b) => b.playerId !== board.playerId)) {
          for (const enemyToken of enemy.tokens) {
            if (enemyToken.progress >= 0 && enemyToken.progress <= OUTER_TRACK_LAST_PROGRESS && this.absoluteCell(enemy.color, enemyToken.progress) === cell) {
              enemyToken.progress = -1;
              capture = { by: board.playerId, victim: enemy.playerId, cell };
            }
          }
        }
      }
    }
    const mover = state.players.find((p) => p.id === playerId)!;
    state.history.unshift(this.event(`${mover.name} moved token ${token.id + 1}`));
    if (board.tokens.every((t) => t.progress === HOME_FINISH_PROGRESS) && !state.winnerIds.includes(playerId)) {
      board.completedAt = Date.now();
      state.winnerIds.push(playerId);
      state.history.unshift(this.event(`${mover.name} finished all tokens`));
    }
    if (state.winnerIds.length >= state.players.length - 1) {
      state.status = "complete";
      state.turnEndsAt = null;
      state.dice = null;
      const room = this.rooms.get(state.code);
      if (room) room.completedAt = Date.now();
    } else if (capture || state.dice === 6) {
      state.dice = null;
      state.turnEndsAt = Date.now() + TURN_MS;
    } else {
      this.advanceTurn(state);
    }
    return { state, capture };
  }

  roomForSocket(socketId: string) {
    const link = this.socketPlayers.get(socketId);
    return link ? this.rooms.get(link.roomCode)?.state : undefined;
  }

  activeRooms() {
    return [...this.rooms.values()].map((room) => room.state);
  }

  cleanupExpiredRooms() {
    const removed: string[] = [];
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      this.markEmptyIfNeeded(room);
      const completedExpired = room.completedAt && now - room.completedAt > COMPLETED_ROOM_TTL_MS;
      const emptyExpired = room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS;
      if (completedExpired || emptyExpired) {
        this.deleteRoom(code);
        removed.push(code);
      }
    }
    return removed;
  }

  deleteRoom(code: string) {
    this.rooms.delete(code);
    for (const [socketId, link] of this.socketPlayers.entries()) {
      if (link.roomCode === code) this.socketPlayers.delete(socketId);
    }
  }

  private legalMoves(state: RoomState) {
    const dice = state.dice;
    if (!dice) return [];
    const board = this.currentBoard(state);
    return board.tokens.filter((token) => this.isLegalProgress(token.progress, dice)).map((token) => ({ board, token }));
  }

  private isLegalProgress(progress: number, dice: number) {
    if (progress === -1) return dice === 6;
    return progress + dice <= HOME_FINISH_PROGRESS;
  }

  private advanceTurn(state: RoomState) {
    state.dice = null;
    state.consecutiveSixes = 0;
    for (let i = 1; i <= state.players.length; i += 1) {
      const next = (state.currentTurn + i) % state.players.length;
      const player = state.players[next];
      const finished = state.winnerIds.includes(player.id);
      if (!finished && (player.connected || player.ai)) {
        state.currentTurn = next;
        break;
      }
    }
    state.turnEndsAt = Date.now() + TURN_MS;
  }

  private scoreMove(state: RoomState, move: { board: PlayerBoard; token: { id: number; progress: number } }) {
    const dice = state.dice ?? 0;
    const next = this.projectProgress(move.token.progress, dice);
    const currentCell = this.isOuterTrack(move.token.progress) ? this.absoluteCell(move.board.color, move.token.progress) : undefined;
    const nextCell = this.isOuterTrack(next) ? this.absoluteCell(move.board.color, next) : undefined;
    const captureCount = nextCell === undefined ? 0 : this.captureVictimCount(state, move.board, nextCell);
    const ownActiveTokens = move.board.tokens.filter((token) => token.progress >= 0 && token.id !== move.token.id);
    const ownTokensOnDestination = nextCell === undefined ? 0 : ownActiveTokens.filter((token) => this.isOuterTrack(token.progress) && this.absoluteCell(move.board.color, token.progress) === nextCell).length;
    const wasInDanger = currentCell !== undefined && !GLOBAL_SAFE_CELLS.has(currentCell) && this.canAnyEnemyReachCell(state, move.board, currentCell);
    const willBeInDanger = nextCell !== undefined && !GLOBAL_SAFE_CELLS.has(nextCell) && this.canAnyEnemyReachCell(state, move.board, nextCell);

    let score = 0;
    if (next === HOME_FINISH_PROGRESS) score += 1000;
    if (captureCount > 0) score += 650 + captureCount * 80;
    if (move.token.progress < HOME_LANE_START_PROGRESS && next >= HOME_LANE_START_PROGRESS) score += 260;
    if (move.token.progress === -1 && next === 0) score += ownActiveTokens.length <= 1 ? 180 : 80;
    if (wasInDanger && !willBeInDanger) score += 180;
    if (nextCell !== undefined && GLOBAL_SAFE_CELLS.has(nextCell)) score += 95;
    if (willBeInDanger) score -= 160;
    if (ownTokensOnDestination > 0 && nextCell !== undefined && !GLOBAL_SAFE_CELLS.has(nextCell)) score -= 75;
    score += next * 4;
    score -= move.token.id * 0.01;
    score += Math.random() * 8;
    return score;
  }

  private projectProgress(progress: number, dice: number) {
    return progress === -1 ? 0 : progress + dice;
  }

  private isOuterTrack(progress: number) {
    return progress >= 0 && progress <= OUTER_TRACK_LAST_PROGRESS;
  }

  private captureVictimCount(state: RoomState, board: PlayerBoard, cell: number) {
    if (GLOBAL_SAFE_CELLS.has(cell)) return 0;
    return state.boards
      .filter((enemy) => enemy.playerId !== board.playerId)
      .flatMap((enemy) => enemy.tokens.map((token) => ({ enemy, token })))
      .filter(({ enemy, token }) => this.isOuterTrack(token.progress) && this.absoluteCell(enemy.color, token.progress) === cell)
      .length;
  }

  private canAnyEnemyReachCell(state: RoomState, board: PlayerBoard, cell: number) {
    return state.boards.some((enemy) => {
      if (enemy.playerId === board.playerId) return false;
      return enemy.tokens.some((token) => this.enemyCanReachCell(enemy, token, cell));
    });
  }

  private enemyCanReachCell(enemy: PlayerBoard, token: TokenState, targetCell: number) {
    if (!this.isOuterTrack(token.progress)) return false;
    for (let dice = 1; dice <= 6; dice += 1) {
      const next = token.progress + dice;
      if (next <= OUTER_TRACK_LAST_PROGRESS && this.absoluteCell(enemy.color, next) === targetCell) return true;
    }
    return false;
  }

  private assertTurn(state: RoomState, playerId: string) {
    if (state.status !== "playing") throw new Error("The match is not active.");
    if (state.players[state.currentTurn]?.id !== playerId) throw new Error("It is not your turn.");
  }

  private currentBoard(state: RoomState) {
    return state.boards.find((b) => b.playerId === state.players[state.currentTurn].id)!;
  }

  private absoluteCell(color: keyof typeof COLOR_META, progress: number) {
    return (COLOR_META[color].start + progress) % 52;
  }

  private context(socketId: string) {
    const link = this.socketPlayers.get(socketId);
    if (!link) throw new Error("Join a room first.");
    const room = this.rooms.get(link.roomCode);
    if (!room) throw new Error("Room no longer exists.");
    const player = room.state.players.find((p) => p.id === link.playerId) ?? room.state.spectators.find((p) => p.id === link.playerId);
    if (!player) throw new Error("Player no longer exists.");
    return { room, player };
  }

  private mustGet(code: string) {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found.");
    return room;
  }

  private makePlayer(id: string, name: string, avatar: string, color: Player["color"], host: boolean): Player {
    return { id, name, avatar, color, connected: true, ready: host, host, rank: 1200, stats: { wins: 0, games: 0 } };
  }

  private generateCode() {
    let code = "";
    do {
      code = randomBytes(8).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase();
    } while (code.length !== 6 || this.rooms.has(code));
    return code;
  }

  private event(text: string): MoveEvent {
    return { id: randomUUID(), text, at: Date.now() };
  }

  private markEmptyIfNeeded(room: InternalRoom) {
    const hasConnectedHumans = [...room.state.players, ...room.state.spectators].some((player) => !player.ai && player.connected);
    room.emptySince = hasConnectedHumans ? undefined : room.emptySince ?? Date.now();
  }
}
