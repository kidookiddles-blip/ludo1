import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import { GameService } from "./game.js";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const app = express();
const httpServer = createServer(app);
const game = new GameService();
const isProduction = process.env.NODE_ENV === "production";
const corsOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? false : true);

const jwtSecret =
  process.env.JWT_SECRET ??
  (isProduction ? undefined : randomUUID());

if (!jwtSecret) {
  throw new Error(
    "JWT_SECRET environment variable is missing. Please configure it before starting the server."
  );
}

if (!process.env.JWT_SECRET && !isProduction) {
  console.warn("JWT_SECRET is not set; using an ephemeral development secret for this process.");
}
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "128kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ludo-aurora", at: new Date().toISOString() }));
app.post("/api/auth/guest", (req, res) => {
  const name = String(req.body?.name ?? "Guest").slice(0, 20);
  const token = jwt.sign(
    {
      sub: randomUUID(),
      name,
      guest: true
    },
    jwtSecret,
    {
      expiresIn: "7d"
    }
  );

  res.json({ token, name });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ ok: false, error: "API route not found." });
});

const clientPath = path.resolve(__dirname, "../client");
app.use(express.static(clientPath));
app.get("*", (_req, res) => res.sendFile(path.join(clientPath, "index.html")));

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
  pingInterval: 10_000,
  pingTimeout: 20_000
});

function emitRoom(code: string) {
  const roomSockets = io.sockets.adapter.rooms.get(code);
  if (!roomSockets) return;
  for (const socketId of roomSockets) {
    const state = game.roomForSocket(socketId);
    if (state) io.to(socketId).emit("roomState", state);
  }
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function safe(socket: GameSocket, action: () => void, ack?: (response: { ok: false; error: string }) => void) {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    ack?.({ ok: false, error: message });
    socket.emit("toast", { title: "Action blocked", body: message, kind: "danger" });
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, ack) => safe(socket, () => {
    const { room, playerId } = game.createRoom(payload, socket.id);
    socket.join(room.code);
    ack({ ok: true, room, playerId });
    emitRoom(room.code);
  }, ack));

  socket.on("joinRoom", (payload, ack) => safe(socket, () => {
    const { room, playerId } = game.joinRoom(payload, socket.id);
    socket.join(room.code);
    ack({ ok: true, room, playerId });
    emitRoom(room.code);
  }, ack));

  socket.on("rejoinRoom", (payload, ack) => safe(socket, () => {
    const { room, playerId } = game.rejoinRoom(payload.code, payload.playerId, socket.id);
    socket.join(room.code);
    ack({ ok: true, room, playerId });
    emitRoom(room.code);
  }, ack));

  socket.on("leaveRoom", (ack) => safe(socket, () => {
    const previous = game.roomForSocket(socket.id);
    const result = game.leaveRoom(socket.id);
    if (previous) socket.leave(previous.code);
    ack?.({ ok: true, ...result });
    if (previous) {
      if (result.closed) {
        io.to(previous.code).emit("roomClosed", { code: previous.code, reason: "The room was closed." });
        io.socketsLeave(previous.code);
      } else if (result.room) {
        emitRoom(result.room.code);
      }
    }
  }, ack));

  socket.on("setReady", (payload) => safe(socket, () => {
    const room = game.setReady(socket.id, payload.ready);
    emitRoom(room.code);
  }));

  socket.on("addAi", (payload) => safe(socket, () => {
    const room = game.addAi(socket.id, payload.difficulty);
    emitRoom(room.code);
  }));

  socket.on("startMatch", () => safe(socket, () => {
    const room = game.startMatch(socket.id);
    emitRoom(room.code);
  }));

  socket.on("rollDice", () => safe(socket, () => {
    const { state, dice, playerId } = game.rollDice(socket.id);
    io.to(state.code).emit("diceRolled", { playerId, value: dice });
    emitRoom(state.code);
  }));

  socket.on("moveToken", (payload) => safe(socket, () => {
    const { state, capture } = game.moveToken(socket.id, payload.tokenId);
    if (capture) io.to(state.code).emit("capture", capture);
    emitRoom(state.code);
  }));

  socket.on("sendChat", (payload) => safe(socket, () => {
    const room = game.sendChat(socket.id, payload.text);
    emitRoom(room.code);
  }));

  socket.on("disconnect", () => {
    const state = game.disconnect(socket.id);
    if (state) emitRoom(state.code);
  });
});

setInterval(() => {
  for (const state of game.tick()) emitRoom(state.code);
  for (const state of game.activeRooms()) {
    const aiAction = state ? game.getAiAction(state) : null;
    if (!state || !aiAction) continue;
    if (aiAction.kind === "roll") {
      const result = game.applyAiRoll(state);
      io.to(state.code).emit("diceRolled", { playerId: result.playerId, value: result.dice });
    } else {
      const result = game.applyMove(state, state.players[state.currentTurn].id, aiAction.tokenId);
      if (result.capture) io.to(state.code).emit("capture", result.capture);
    }
    emitRoom(state.code);
  }
  for (const code of game.cleanupExpiredRooms()) {
    io.to(code).emit("roomClosed", { code, reason: "This match has ended." });
    io.socketsLeave(code);
  }
}, 1200);

httpServer.listen(port, () => {
  console.log(`Ludo Aurora server is running on port ${port}`);
});
