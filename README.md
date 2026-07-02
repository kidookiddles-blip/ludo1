# Ludo Aurora

Browser Ludo platform with a Socket.IO multiplayer server, server-authoritative rules, reconnectable rooms, AI seats, lobby chat, polished responsive UI, Docker support, and fully temporary in-memory rooms.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:8080`. The server also serves the Vite client in development through the same process.

## Build and test

```bash
npm run build
npm test
```

## Features

- Create or join 6-character room codes with optional passwords.
- 2, 3, or 4 player rooms with ready states and host-controlled start.
- Rejoin after refresh using local player identity.
- Spectator join mode when a room is full or already playing.
- Server-side dice, legal move validation, safe cells, captures, home path, win detection, turn timers, and three-sixes skip rule.
- AI opponents with heuristic move scoring.
- Realtime lobby/game chat, history, connection status, responsive HUD, animated dice, glossy tokens, and premium board styling.
- Guest JWT endpoint for lightweight identity without storing user records.
- Rooms and match state live only in server memory. Completed rooms are closed automatically, and empty disconnected rooms expire automatically.
- Dockerfile and docker-compose for single-service app deployment.

## Deployment

Set these environment variables in Vercel/Railway/Render/DigitalOcean/AWS/GCP/Azure:

```bash
PORT=8080
CLIENT_ORIGIN=https://your-domain.example
JWT_SECRET=long-random-secret
```

This app intentionally stores no game data. If the server restarts, all active rooms disappear. For multiplayer WebSockets, deploy the Node server on Railway, Render, Fly.io, DigitalOcean, or another service that supports long-running WebSocket connections.
