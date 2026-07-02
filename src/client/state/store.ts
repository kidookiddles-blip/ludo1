import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, RoomState, ServerToClientEvents } from "../../shared/types";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Toast {
  id: string;
  title: string;
  body?: string;
  kind?: "info" | "success" | "danger";
}

interface AppState {
  socket?: GameSocket;
  connected: boolean;
  room?: RoomState;
  playerId?: string;
  toasts: Toast[];
  muted: boolean;
  lastDice?: number;
  connect: () => GameSocket;
  setRoom: (room?: RoomState) => void;
  setPlayerId: (id?: string) => void;
  pushToast: (toast: Omit<Toast, "id">) => void;
  clearToast: (id: string) => void;
  setMuted: (muted: boolean) => void;
  setLastDice: (value?: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connected: false,
  toasts: [],
  muted: localStorage.getItem("ludo-muted") === "true",
  connect: () => {
    const existing = get().socket;
    if (existing) return existing;
    const socket: GameSocket = io({ autoConnect: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 3000 });
    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));
    socket.on("roomState", (room) => set({ room }));
    socket.on("roomClosed", ({ reason }) => {
      localStorage.removeItem("ludo-room-code");
      set({ room: undefined });
      get().pushToast({ title: "Room closed", body: reason, kind: "info" });
    });
    socket.on("toast", (toast) => get().pushToast(toast));
    socket.on("diceRolled", ({ value }) => set({ lastDice: value }));
    set({ socket });
    return socket;
  },
  setRoom: (room) => set({ room }),
  setPlayerId: (playerId) => {
    if (playerId) localStorage.setItem("ludo-player-id", playerId);
    else localStorage.removeItem("ludo-player-id");
    set({ playerId });
  },
  pushToast: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [{ id, ...toast }, ...state.toasts].slice(0, 4) }));
    window.setTimeout(() => get().clearToast(id), 4200);
  },
  clearToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setMuted: (muted) => {
    localStorage.setItem("ludo-muted", String(muted));
    set({ muted });
  },
  setLastDice: (lastDice) => set({ lastDice })
}));
