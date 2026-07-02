import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Copy, Crown, LogIn, LogOut, MessageCircle, Music, Play, Radio, Shield, Sparkles, Users, VolumeX } from "lucide-react";
import { HOME_LANE_START_PROGRESS, Player, PlayerBoard, RoomState } from "../shared/types";
import { useAppStore } from "./state/store";
import { gameAudio } from "./audio";
import "./styles/app.css";

const avatars = ["🧿", "⚡", "🌙", "🔥", "💎", "🚀", "👑", "🎲"];

function App() {
  const socket = useAppStore((s) => s.connect)();
  const { room, playerId, connected, muted, toasts, lastDice } = useAppStore();
  const setRoom = useAppStore((s) => s.setRoom);
  const setPlayerId = useAppStore((s) => s.setPlayerId);
  const pushToast = useAppStore((s) => s.pushToast);
  const setMuted = useAppStore((s) => s.setMuted);
  const [profile, setProfile] = useState({ name: `Player${Math.floor(Math.random() * 900) + 100}`, avatar: avatars[0] });
  const [roomCode, setRoomCode] = useState("");
  const [password, setPassword] = useState("");
  const previousRoomRef = useRef<RoomState | undefined>(undefined);

  useEffect(() => {
    const savedPlayer = localStorage.getItem("ludo-player-id");
    const savedRoom = localStorage.getItem("ludo-room-code");
    if (savedPlayer && savedRoom) {
      socket.emit("rejoinRoom", { code: savedRoom, playerId: savedPlayer }, (ack) => {
        if (ack.ok) {
          setRoom(ack.room);
          setPlayerId(ack.playerId);
        }
      });
    }
  }, [socket, setPlayerId, setRoom]);

  useEffect(() => {
    if (room?.code) localStorage.setItem("ludo-room-code", room.code);
  }, [room?.code]);

  useEffect(() => {
    gameAudio.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      gameAudio.unlock();
      if ((event.target as Element | null)?.closest("button")) gameAudio.play("button");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const onDiceRolled = () => {
      gameAudio.play("diceRoll");
      gameAudio.play("diceLand", 180);
      gameAudio.play("success", 300);
    };
    const onCapture = () => gameAudio.play("capture");
    socket.on("diceRolled", onDiceRolled);
    socket.on("capture", onCapture);
    return () => {
      socket.off("diceRolled", onDiceRolled);
      socket.off("capture", onCapture);
    };
  }, [socket]);

  useEffect(() => {
    playRoomAudio(previousRoomRef.current, room);
    previousRoomRef.current = room;
  }, [room]);

  const me = room?.players.find((p) => p.id === playerId) ?? room?.spectators.find((p) => p.id === playerId);

  const createRoom = () => {
    socket.emit("createRoom", {
      name: "Aurora Table",
      playerName: profile.name,
      avatar: profile.avatar,
      maxPlayers: 4,
      isPrivate: Boolean(password),
      password
    }, (ack) => {
      if (!ack.ok) return pushToast({ title: "Could not create room", body: ack.error, kind: "danger" });
      setRoom(ack.room);
      setPlayerId(ack.playerId);
      gameAudio.play("notification");
      pushToast({ title: "Room created", body: `Share ${ack.room.code}`, kind: "success" });
    });
  };

  const joinRoom = (spectator = false) => {
    socket.emit("joinRoom", {
      code: roomCode,
      playerName: profile.name,
      avatar: profile.avatar,
      password,
      spectator
    }, (ack) => {
      if (!ack.ok) return pushToast({ title: "Could not join", body: ack.error, kind: "danger" });
      setRoom(ack.room);
      setPlayerId(ack.playerId);
      gameAudio.play("notification");
      pushToast({ title: spectator ? "Spectating" : "Joined room", body: ack.room.code, kind: "success" });
    });
  };

  const leaveRoom = () => {
    socket.emit("leaveRoom", (ack) => {
      if (ack && !ack.ok) return pushToast({ title: "Could not leave", body: ack.error, kind: "danger" });
      localStorage.removeItem("ludo-room-code");
      setRoom(undefined);
      setPlayerId(undefined);
      pushToast({ title: "Left room", kind: "info" });
    });
  };

  return (
    <main className="app-shell">
      <div className="aurora-bg" />
      <header className="topbar">
        <div className="brand"><span>Ludo</span> Aurora</div>
        <div className="status-pill"><Radio size={16} /> {connected ? "Live" : "Reconnecting"}</div>
        <button className="icon-btn" onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={18} /> : <Music size={18} />}
        </button>
      </header>

      {!room ? (
        <Landing
          profile={profile}
          setProfile={setProfile}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          password={password}
          setPassword={setPassword}
          createRoom={createRoom}
          joinRoom={joinRoom}
        />
      ) : room.status === "lobby" ? (
        <Lobby room={room} me={me} socket={socket} leaveRoom={leaveRoom} />
      ) : (
        <Game room={room} me={me} playerId={playerId} socket={socket} lastDice={lastDice} leaveRoom={leaveRoom} />
      )}

      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div key={toast.id} className={`toast ${toast.kind ?? "info"}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}>
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </main>
  );
}

function Landing(props: {
  profile: { name: string; avatar: string };
  setProfile: (profile: { name: string; avatar: string }) => void;
  roomCode: string;
  setRoomCode: (code: string) => void;
  password: string;
  setPassword: (value: string) => void;
  createRoom: () => void;
  joinRoom: (spectator?: boolean) => void;
}) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow"><Sparkles size={16} /> Real-time server-authoritative multiplayer</p>
        <h1>Ludo Aurora</h1>
        <p className="lead">Create a private room, share the code across the world, and play a cinematic Ludo match with validated moves, AI seats, chat, reconnect, and responsive board play.</p>
        <div className="feature-row">
          <span><Shield size={16} /> Anti-cheat turns</span>
          <span><Users size={16} /> 2-4 players</span>
          <span><Bot size={16} /> AI opponents</span>
        </div>
      </div>
      <div className="launch-panel">
        <div className="profile-row">
          <input value={props.profile.name} onChange={(e) => props.setProfile({ ...props.profile, name: e.target.value })} maxLength={20} />
          <select value={props.profile.avatar} onChange={(e) => props.setProfile({ ...props.profile, avatar: e.target.value })}>
            {avatars.map((avatar) => <option key={avatar}>{avatar}</option>)}
          </select>
        </div>
        <input placeholder="Optional room password" value={props.password} onChange={(e) => props.setPassword(e.target.value)} />
        <button className="primary-btn" onClick={props.createRoom}><Play size={18} /> Create Room</button>
        <div className="join-row">
          <input placeholder="Room code" value={props.roomCode} onChange={(e) => props.setRoomCode(e.target.value.toUpperCase())} maxLength={8} />
          <button onClick={() => props.joinRoom(false)}><LogIn size={18} /> Join</button>
        </div>
        <button className="ghost-btn" onClick={() => props.joinRoom(true)}><MessageCircle size={18} /> Join as Spectator</button>
      </div>
      <MiniBoard />
    </section>
  );
}

function Lobby({ room, me, socket, leaveRoom }: { room: RoomState; me?: Player; socket: ReturnType<typeof useAppStore.getState>["socket"]; leaveRoom: () => void }) {
  const copy = () => navigator.clipboard?.writeText(room.code);
  return (
    <section className="lobby-grid">
      <div className="room-card">
        <p className="eyebrow">Room lobby</p>
        <h2>{room.name}</h2>
        <button className="code-chip" onClick={copy}><Copy size={16} /> {room.code}</button>
        <div className="players">
          {room.players.map((player) => <PlayerCard key={player.id} player={player} />)}
          {Array.from({ length: room.maxPlayers - room.players.length }, (_, i) => <div className="empty-seat" key={i}>Open seat</div>)}
        </div>
        <div className="lobby-actions">
          {!me?.host && <button onClick={() => socket?.emit("setReady", { ready: !me?.ready })}>{me?.ready ? "Unready" : "Ready"}</button>}
          {me?.host && <button onClick={() => socket?.emit("addAi", { difficulty: "hard" })}><Bot size={18} /> Add AI</button>}
          {me?.host && <button className="primary-btn" onClick={() => socket?.emit("startMatch")}><Play size={18} /> Start Match</button>}
          <button className="danger-btn" onClick={leaveRoom}><LogOut size={18} /> Leave</button>
        </div>
      </div>
      <ChatPanel room={room} socket={socket} />
    </section>
  );
}

function Game({ room, me, playerId, socket, lastDice, leaveRoom }: { room: RoomState; me?: Player; playerId?: string; socket: ReturnType<typeof useAppStore.getState>["socket"]; lastDice?: number; leaveRoom: () => void }) {
  const current = room.players[room.currentTurn];
  const myTurn = current?.id === playerId;
  const legal = myTurn && room.dice;
  const topPlayers = room.players.length <= 2 ? room.players.slice(0, 1) : room.players.slice(0, 2);
  const bottomPlayers = room.players.length <= 2 ? room.players.slice(1) : room.players.slice(2);
  return (
    <section className="king-game">
      <div className="match-bar">
        <div className="coin-bank"><span>Coins</span><strong>4,580</strong></div>
        <div className="turn-badge"><Crown size={18} /> {current?.name ?? "Waiting"}'s turn</div>
        <button className="danger-btn" onClick={leaveRoom}><LogOut size={18} /> Leave</button>
      </div>

      <div className="player-rail top">
        {topPlayers.map((player) => (
          <GamePlayerPanel
            key={player.id}
            player={player}
            active={player.id === current?.id}
            score={room.winnerIds.includes(player.id) ? "Done" : "0"}
            diceValue={player.id === current?.id ? room.dice ?? lastDice ?? 1 : undefined}
            diceRolling={player.id === current?.id && myTurn && !room.dice}
            onRoll={() => socket?.emit("rollDice")}
            diceDisabled={!myTurn || player.id !== playerId || Boolean(room.dice) || Boolean(me?.ai)}
          />
        ))}
      </div>

      <div className="table-row">
        <LudoBoard room={room} playerId={playerId} socket={socket} canMove={Boolean(legal)} />
        <aside className="match-side">
          <div className="timer"><span style={{ width: `${timerPercent(room)}%` }} /></div>
          <ChatPanel room={room} socket={socket} compact />
          <div className="history">
            <h3>Moves</h3>
            {room.history.slice(0, 5).map((event) => <p key={event.id}>{event.text}</p>)}
          </div>
        </aside>
      </div>

      <div className="player-rail bottom">
        {bottomPlayers.map((player) => (
          <GamePlayerPanel
            key={player.id}
            player={player}
            active={player.id === current?.id}
            score={room.winnerIds.includes(player.id) ? "Done" : "0"}
            diceValue={player.id === current?.id ? room.dice ?? lastDice ?? 1 : undefined}
            diceRolling={player.id === current?.id && myTurn && !room.dice}
            onRoll={() => socket?.emit("rollDice")}
            diceDisabled={!myTurn || player.id !== playerId || Boolean(room.dice) || Boolean(me?.ai)}
          />
        ))}
      </div>

      <div className="mobile-leave">
        <div className="timer"><span style={{ width: `${timerPercent(room)}%` }} /></div>
      </div>
      {room.status === "complete" && <div className="victory"><Crown size={42} /> {room.players.find((p) => p.id === room.winnerIds[0])?.name} wins</div>}
    </section>
  );
}

function GamePlayerPanel({ player, active, score, diceValue, diceRolling, onRoll, diceDisabled }: { player: Player; active?: boolean; score: string; diceValue?: number; diceRolling?: boolean; onRoll?: () => void; diceDisabled?: boolean }) {
  return (
    <div className={`game-player ${player.color} ${active ? "active" : ""}`}>
      <div className="flag-pill">{player.host ? "Host" : player.ai ? "AI" : "Player"}</div>
      <div className="portrait">{player.avatar}</div>
      <div className="player-name">{player.name}</div>
      <div className="panel-score"><Crown size={20} /> {score}</div>
      <div className="status-dots"><span /><span /><span /><span /></div>
      {active && diceValue && <DiceBox value={diceValue} rolling={diceRolling} onRoll={onRoll} disabled={diceDisabled} />}
    </div>
  );
}

function LudoBoard({ room, playerId, socket, canMove }: { room: RoomState; playerId?: string; socket: ReturnType<typeof useAppStore.getState>["socket"]; canMove: boolean }) {
  const squares = useMemo(() => boardSquares(), []);
  const territoryNames = {
    emerald: room.players.find((player) => player.color === "emerald")?.name ?? "",
    sun: room.players.find((player) => player.color === "sun")?.name ?? "",
    ruby: room.players.find((player) => player.color === "ruby")?.name ?? "",
    sapphire: room.players.find((player) => player.color === "sapphire")?.name ?? ""
  };
  return (
    <div className="board-wrap">
      <div className="board classic-board">
        {squares.map((square) => (
          <div key={`${square.row}-${square.col}`} className={`board-square ${square.classes}`} style={{ gridColumn: square.col + 1, gridRow: square.row + 1 }}>
            {square.star && <span>☆</span>}
          </div>
        ))}
        <div className="center-finish">
          <span className="tri emerald" />
          <span className="tri sun" />
          <span className="tri sapphire" />
          <span className="tri ruby" />
        </div>
        <div className="home-label emerald">{territoryNames.emerald}</div>
        <div className="home-label sun">{territoryNames.sun}</div>
        <div className="home-label ruby">{territoryNames.ruby}</div>
        <div className="home-label sapphire">{territoryNames.sapphire}</div>
        {room.boards.flatMap((board) => board.tokens.map((token) => ({ board, token }))).sort((a, b) => {
          const aMine = a.board.playerId === playerId ? 1 : 0;
          const bMine = b.board.playerId === playerId ? 1 : 0;
          return aMine - bMine;
        }).map(({ board, token }) => {
          const pos = tokenPosition(board, token.progress, token.id);
          const mine = board.playerId === playerId;
          return (
            <button
              key={`${board.playerId}-${token.id}`}
              className={`token ${board.color} ${mine && canMove ? "selectable" : ""}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
              onClick={() => mine && canMove && socket?.emit("moveToken", { tokenId: token.id })}
              title={`${board.color} token ${token.id + 1}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function DiceBox({ value, rolling, onRoll, disabled }: { value: number; rolling?: boolean; onRoll?: () => void; disabled?: boolean }) {
  return (
    <button className={`dice-box ${rolling ? "rolling" : ""}`} onClick={onRoll} disabled={disabled}>
      <span>{diceFace(value)}</span>
    </button>
  );
}

function diceFace(value: number) {
  return ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][value] ?? value;
}

function ChatPanel({ room, socket, compact }: { room: RoomState; socket: ReturnType<typeof useAppStore.getState>["socket"]; compact?: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <h3>Chat</h3>
      <form onSubmit={(e) => { e.preventDefault(); socket?.emit("sendChat", { text }); setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message or emoji" maxLength={160} />
      </form>
      <div className="messages">
        {room.chat.map((message) => <p key={message.id}><strong>{message.name}</strong> {message.text}</p>)}
      </div>
    </div>
  );
}

function PlayerCard({ player, active, diceValue, diceRolling, onRoll, diceDisabled }: { player: Player; active?: boolean; diceValue?: number; diceRolling?: boolean; onRoll?: () => void; diceDisabled?: boolean }) {
  return (
    <div className={`player-card ${player.color} ${active ? "active" : ""}`}>
      <span className="avatar">{player.avatar}</span>
      <div><strong>{player.name}</strong><small>{player.host ? "Host" : player.ready ? "Ready" : "Waiting"} · {player.connected || player.ai ? "Online" : "Rejoin pending"}</small></div>
      {active && diceValue && <DiceBox value={diceValue} rolling={diceRolling} onRoll={onRoll} disabled={diceDisabled} />}
      {player.host && <Crown size={16} />}
    </div>
  );
}

function MiniBoard() {
  return <div className="mini-board"><div /><div /><div /><div /><span /></div>;
}

function timerPercent(room: RoomState) {
  if (!room.turnEndsAt) return 0;
  return Math.max(0, Math.min(100, ((room.turnEndsAt - Date.now()) / 30000) * 100));
}

function playRoomAudio(previous: RoomState | undefined, next: RoomState | undefined) {
  if (!previous || !next || previous.code !== next.code) return;

  if (previous.currentTurn !== next.currentTurn && next.status === "playing") {
    gameAudio.play("turn");
  }

  if (previous.status !== "complete" && next.status === "complete") {
    gameAudio.play("victory");
  }

  const previousHistoryIds = new Set(previous.history.map((event) => event.id));
  const newHistory = next.history.filter((event) => !previousHistoryIds.has(event.id));
  if (newHistory.some((event) => /joined|begun|lost connection|reconnected|left/i.test(event.text))) {
    gameAudio.play("notification");
  }

  if (!previous.boards.length || !next.boards.length) return;
  const previousTokens = new Map<string, number>();
  for (const board of previous.boards) {
    for (const token of board.tokens) previousTokens.set(`${board.playerId}:${token.id}`, token.progress);
  }

  for (const board of next.boards) {
    for (const token of board.tokens) {
      const key = `${board.playerId}:${token.id}`;
      const before = previousTokens.get(key);
      if (before === undefined || before === token.progress) continue;
      if (before === -1 && token.progress === 0) gameAudio.play("spawn");
      else if (before >= 0 && token.progress > before) gameAudio.playSteps(token.progress - before);
    }
  }
}

function boardSquares() {
  const path = new Set(VISUAL_PATH.map(([row, col]) => `${row},${col}`));
  const stars = new Set(["6,1", "2,6", "1,8", "6,12", "8,13", "12,8", "13,6", "8,2"]);
  const squares: { row: number; col: number; classes: string; star?: boolean }[] = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const classes: string[] = [];
      if (row <= 5 && col <= 5) classes.push("yard emerald-yard");
      else if (row <= 5 && col >= 9) classes.push("yard sun-yard");
      else if (row >= 9 && col <= 5) classes.push("yard ruby-yard");
      else if (row >= 9 && col >= 9) classes.push("yard sapphire-yard");
      else if (row >= 6 && row <= 8 && col >= 6 && col <= 8) classes.push("center-cell");
      else if (path.has(`${row},${col}`)) classes.push("path-cell");
      else classes.push("blank-cell");

      if (row === 7 && col >= 1 && col <= 5) classes.push("emerald-lane");
      if (col === 7 && row >= 1 && row <= 5) classes.push("sun-lane");
      if (row === 7 && col >= 9 && col <= 13) classes.push("sapphire-lane");
      if (col === 7 && row >= 9 && row <= 13) classes.push("ruby-lane");
      squares.push({ row, col, classes: classes.join(" "), star: stars.has(`${row},${col}`) });
    }
  }
  return squares;
}

const VISUAL_PATH = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0]
];

const VISUAL_START: Record<PlayerBoard["color"], number> = {
  emerald: 0,
  sun: 13,
  sapphire: 26,
  ruby: 39
};

const HOME_SLOTS: Record<PlayerBoard["color"], number[][]> = {
  emerald: [[2, 2], [2, 4], [4, 2], [4, 4]],
  sun: [[2, 10], [2, 12], [4, 10], [4, 12]],
  ruby: [[10, 2], [10, 4], [12, 2], [12, 4]],
  sapphire: [[10, 10], [10, 12], [12, 10], [12, 12]]
};

const FINISH_LANES: Record<PlayerBoard["color"], number[][]> = {
  emerald: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  sun: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  sapphire: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  ruby: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
};

function tokenPosition(board: PlayerBoard, progress: number, tokenId: number) {
  const coord = progress === -1
    ? HOME_SLOTS[board.color][tokenId]
    : progress >= HOME_LANE_START_PROGRESS
      ? FINISH_LANES[board.color][Math.min(5, progress - HOME_LANE_START_PROGRESS)]
      : VISUAL_PATH[(VISUAL_START[board.color] + progress) % VISUAL_PATH.length];
  return gridPoint(coord[0], coord[1]);
}

function gridPoint(row: number, col: number) {
  return { x: ((col + 0.5) / 15) * 100, y: ((row + 0.5) / 15) * 100 };
}

createRoot(document.getElementById("root")!).render(<App />);
