import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: res => res.setHeader("Cache-Control", "no-store")
  })
);

app.get("/health", (_, res) => res.send("ok"));

const rooms = new Map();

function getState(room) {
  if (!rooms.has(room)) {
    rooms.set(room, {
      players: new Map(),
      commits: new Map(),
      reveals: new Map(),
      guesses: new Map(),
      scores: new Map()
    });
  }
  return rooms.get(room);
}

function playersList(state) {
  return Array.from(state.players.values()).map(p => ({
    id: p.id,
    name: p.name || "Player",
    online: p.online
  }));
}

function emitPlayers(room) {
  const s = getState(room);
  io.to(room).emit("players", {
    players: playersList(s),
    scores: Object.fromEntries(s.scores)
  });
}

function maybeResolve(room) {
  const s = getState(room);
  const ids = Array.from(s.players.keys());
  if (ids.length < 2) return;
  const bothGuessed = ids.every(id => s.guesses.has(id));
  const bothRevealed = ids.every(id => s.reveals.has(id));
  if (bothGuessed && !bothRevealed) io.to(room).emit("reveal:request");
  if (bothGuessed && bothRevealed) resolveRoom(room);
}

function resolveRoom(room) {
  const s = getState(room);
  const ids = Array.from(s.players.keys());
  if (ids.length < 2) return;
  const [a, b] = ids;

  const aRev = s.reveals.get(a);
  const bRev = s.reveals.get(b);
  const aCom = s.commits.get(a);
  const bCom = s.commits.get(b);

  const aHash = crypto.createHash("sha256").update(`${aRev.secret}:${aRev.nonce}`).digest("hex");
  const bHash = crypto.createHash("sha256").update(`${bRev.secret}:${bRev.nonce}`).digest("hex");

  if (aCom !== aHash || bCom !== bHash) return;

  const aGuess = s.guesses.get(a);
  const bGuess = s.guesses.get(b);

  const aOk = aGuess === bRev.secret;
  const bOk = bGuess === aRev.secret;

  s.scores.set(a, (s.scores.get(a) || 0) + (aOk ? 1 : 0));
  s.scores.set(b, (s.scores.get(b) || 0) + (bOk ? 1 : 0));

  io.to(a).emit("round:result", {
    you: { secret: aRev.secret, guess: aGuess, correct: aOk },
    opponent: { secret: bRev.secret, guess: bGuess, correct: bOk }
  });
  io.to(b).emit("round:result", {
    you: { secret: bRev.secret, guess: bGuess, correct: bOk },
    opponent: { secret: aRev.secret, guess: aGuess, correct: aOk }
  });

  emitPlayers(room);
}

io.on("connection", socket => {
  let room = "";
  let name = "";

  socket.on("join", r => {
    room = String(r || "").toUpperCase();
    if (!room) return;
    socket.join(room);
    const s = getState(room);
    s.players.set(socket.id, { id: socket.id, name: name || "Player", online: true });
    socket.emit("joined", { room });
    socket.to(room).emit("presence", { type: "join", id: socket.id, name: name || "Player" });
    emitPlayers(room);
  });

  socket.on("name:set", ({ room: r, name: n }) => {
    if (!room || r !== room) return;
    name = String(n || "Player").slice(0, 20);
    const s = getState(room);
    const p = s.players.get(socket.id);
    if (p) p.name = name;
    emitPlayers(room);
  });

  socket.on("chat", m => {
    if (!room) return;
    io.to(room).emit("chat", { user: m.user, text: m.text, ts: Date.now() });
  });

  socket.on("secret:commit", ({ room: r, commit }) => {
    if (!room || r !== room) return;
    const s = getState(room);
    s.commits.set(socket.id, commit);
    maybeResolve(room);
  });

  socket.on("secret:reveal", ({ room: r, secret, nonce }) => {
    if (!room || r !== room) return;
    const s = getState(room);
    s.reveals.set(socket.id, { secret, nonce });
    maybeResolve(room);
  });

  socket.on("guess:submit", ({ room: r, guess }) => {
    if (!room || r !== room) return;
    const s = getState(room);
    s.guesses.set(socket.id, guess);
    maybeResolve(room);
  });

  socket.on("round:new", ({ room: r }) => {
    if (!room || r !== room) return;
    const s = getState(room);
    s.commits.clear();
    s.reveals.clear();
    s.guesses.clear();
    io.to(room).emit("round:reset");
  });

  socket.on("disconnect", () => {
    if (!room) return;
    const s = getState(room);
    const p = s.players.get(socket.id);
    if (p) p.online = false;
    socket.to(room).emit("presence", { type: "leave", id: socket.id, name: p ? p.name : "Player" });
    emitPlayers(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
