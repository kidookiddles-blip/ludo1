import { afterEach, describe, expect, it, vi } from "vitest";
import { GameService } from "../src/server/game";

function makeStartedRoom() {
  const service = new GameService();
  const a = service.createRoom({ name: "Test", playerName: "Asha", avatar: "A", maxPlayers: 2, isPrivate: false }, "s1");
  service.joinRoom({ code: a.room.code, playerName: "Ben", avatar: "B" }, "s2");
  service.setReady("s2", true);
  const room = service.startMatch("s1");
  return { service, room };
}

describe("GameService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates unique joinable rooms", () => {
    const service = new GameService();
    const result = service.createRoom({ name: "Table", playerName: "Host", avatar: "H", maxPlayers: 4, isPrivate: false }, "socket-a");
    expect(result.room.code).toHaveLength(6);
    const joined = service.joinRoom({ code: result.room.code, playerName: "Guest", avatar: "G" }, "socket-b");
    expect(joined.room.players).toHaveLength(2);
  });

  it("always generates six-character room codes", () => {
    const service = new GameService();
    for (let index = 0; index < 100; index += 1) {
      const result = service.createRoom({ name: "Table", playerName: `Host${index}`, avatar: "H", maxPlayers: 4, isPrivate: false }, `socket-${index}`);
      expect(result.room.code).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it("requires all non-host players to be ready", () => {
    const service = new GameService();
    const result = service.createRoom({ name: "Table", playerName: "Host", avatar: "H", maxPlayers: 2, isPrivate: false }, "socket-a");
    service.joinRoom({ code: result.room.code, playerName: "Guest", avatar: "G" }, "socket-b");
    expect(() => service.startMatch("socket-a")).toThrow(/ready/i);
  });

  it("starts with all tokens in yard", () => {
    const { room } = makeStartedRoom();
    expect(room.boards).toHaveLength(2);
    expect(room.boards[0].tokens.every((token) => token.progress === -1)).toBe(true);
  });

  it("expires empty disconnected rooms", () => {
    vi.useFakeTimers();
    const service = new GameService();
    const result = service.createRoom({ name: "Temp", playerName: "Host", avatar: "H", maxPlayers: 2, isPrivate: false }, "socket-a");
    service.disconnect("socket-a");
    vi.advanceTimersByTime(91_000);
    expect(service.cleanupExpiredRooms()).toContain(result.room.code);
    expect(service.activeRooms()).toHaveLength(0);
  });

  it("hands host to the next player when the host leaves", () => {
    const service = new GameService();
    const result = service.createRoom({ name: "Table", playerName: "Host", avatar: "H", maxPlayers: 3, isPrivate: false }, "socket-a");
    service.joinRoom({ code: result.room.code, playerName: "Guest", avatar: "G" }, "socket-b");
    const leave = service.leaveRoom("socket-a");
    expect(leave.closed).toBe(false);
    expect(leave.room?.players).toHaveLength(1);
    expect(leave.room?.players[0].host).toBe(true);
    expect(leave.room?.hostId).toBe(leave.room?.players[0].id);
  });

  it("closes the room when the final player leaves", () => {
    const service = new GameService();
    service.createRoom({ name: "Solo", playerName: "Host", avatar: "H", maxPlayers: 2, isPrivate: false }, "socket-a");
    const leave = service.leaveRoom("socket-a");
    expect(leave.closed).toBe(true);
    expect(service.activeRooms()).toHaveLength(0);
  });

  it("captures only on exact normal-square landing and gives an extra turn", () => {
    const { service, room } = makeStartedRoom();
    const attacker = room.boards[0];
    const defender = room.boards[1];
    attacker.tokens[0].progress = 0;
    defender.tokens[0].progress = 14;
    room.currentTurn = 0;
    room.dice = 1;

    const result = service.applyMove(room, attacker.playerId, 0);

    expect(result.capture).toEqual({ by: attacker.playerId, victim: defender.playerId, cell: 40 });
    expect(defender.tokens[0].progress).toBe(-1);
    expect(room.currentTurn).toBe(0);
    expect(room.dice).toBeNull();
  });

  it("does not capture on safe squares", () => {
    const { service, room } = makeStartedRoom();
    const attacker = room.boards[0];
    const defender = room.boards[1];
    attacker.tokens[0].progress = 7;
    defender.tokens[0].progress = 21;
    room.currentTurn = 0;
    room.dice = 1;

    const result = service.applyMove(room, attacker.playerId, 0);

    expect(result.capture).toBeUndefined();
    expect(defender.tokens[0].progress).toBe(21);
  });

  it("does not capture when passing over a token", () => {
    const { service, room } = makeStartedRoom();
    const attacker = room.boards[0];
    const defender = room.boards[1];
    attacker.tokens[0].progress = 0;
    defender.tokens[0].progress = 14;
    room.currentTurn = 0;
    room.dice = 3;

    const result = service.applyMove(room, attacker.playerId, 0);

    expect(result.capture).toBeUndefined();
    expect(defender.tokens[0].progress).toBe(14);
  });

  it("requires a captured token to roll six before re-entering", () => {
    const { service, room } = makeStartedRoom();
    const attacker = room.boards[0];
    const defender = room.boards[1];
    attacker.tokens[0].progress = 0;
    defender.tokens[0].progress = 14;
    room.currentTurn = 0;
    room.dice = 1;
    service.applyMove(room, attacker.playerId, 0);

    room.currentTurn = 1;
    room.dice = 5;

    expect(() => service.applyMove(room, defender.playerId, 0)).toThrow(/not legal/i);
    expect(defender.tokens[0].progress).toBe(-1);
  });

  it("enters the home lane immediately without an extra outer-track square", () => {
    const { service, room } = makeStartedRoom();
    const ruby = room.boards[0];
    ruby.tokens[0].progress = 50;
    room.currentTurn = 0;
    room.dice = 1;

    service.applyMove(room, ruby.playerId, 0);

    expect(ruby.tokens[0].progress).toBe(51);
  });

  it("requires exact dice to finish from the home lane", () => {
    const { service, room } = makeStartedRoom();
    const ruby = room.boards[0];
    ruby.tokens[0].progress = 55;
    room.currentTurn = 0;
    room.dice = 2;

    expect(() => service.applyMove(room, ruby.playerId, 0)).toThrow(/not legal/i);

    room.dice = 1;
    service.applyMove(room, ruby.playerId, 0);
    expect(ruby.tokens[0].progress).toBe(56);
  });

  it("AI evaluates all legal tokens and chooses a capture", () => {
    const { service, room } = makeStartedRoom();
    room.players[1].ai = true;
    const human = room.boards[0];
    const ai = room.boards[1];
    human.tokens[0].progress = 2;
    ai.tokens[0].progress = 0;
    ai.tokens[1].progress = 14;
    room.currentTurn = 1;
    room.dice = 1;

    expect(service.getAiAction(room)).toEqual({ kind: "move", tokenId: 1 });
  });

  it("lets each player move independently from a shared safe square", () => {
    const { service, room } = makeStartedRoom();
    const ruby = room.boards[0];
    const sapphire = room.boards[1];
    ruby.tokens[0].progress = 8;
    sapphire.tokens[0].progress = 21;

    room.currentTurn = 0;
    room.dice = 2;
    const rubyMove = service.applyMove(room, ruby.playerId, 0);
    expect(rubyMove.capture).toBeUndefined();
    expect(ruby.tokens[0].progress).toBe(10);
    expect(sapphire.tokens[0].progress).toBe(21);

    room.currentTurn = 1;
    room.dice = 3;
    const sapphireMove = service.applyMove(room, sapphire.playerId, 0);
    expect(sapphireMove.capture).toBeUndefined();
    expect(ruby.tokens[0].progress).toBe(10);
    expect(sapphire.tokens[0].progress).toBe(24);
  });
});
