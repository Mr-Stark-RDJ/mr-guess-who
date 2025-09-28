import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

const rooms = new Map();

function getRoom(code) {
  code = String(code || "").toUpperCase();
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: new Map(),
      scores: new Map(),
      commits: new Map(),
      secrets: new Map(),
      nonces: new Map(),
      guesses: new Map(),
      submitted: new Set(),
      revealed: new Set(),
      round: 1,
      resultEmittedFor: new Set(),
    });
  }
  return rooms.get(code);
}

function emitPlayers(rm) {
  const players = Array.from(rm.players.values()).map((p) => ({
    id: p.pid,
    name: p.name,
    online: p.online,
  }));
  const scores = Object.fromEntries(rm.scores);
  io.to(rm.code).emit("players", { players, scores });
}

io.on("connection", (socket) => {
  socket.data.room = null;
  socket.data.pid = null;

  socket.on("join", (payload) => {
    const code = typeof payload === "string" ? payload : payload?.code;
    const pid = typeof payload === "string" ? socket.id : payload?.pid;
    const name = typeof payload === "string" ? "Player" : payload?.name || "Player";

    const rm = getRoom(code);
    socket.join(rm.code);
    socket.data.room = rm.code;
    socket.data.pid = pid;

    const existing = rm.players.get(pid);
    if (existing) {
      existing.socketId = socket.id;
      existing.online = true;
      if (name && name !== existing.name) existing.name = String(name).slice(0, 20);
    } else {
      rm.players.set(pid, { pid, name: String(name).slice(0, 20), online: true, socketId: socket.id });
      if (!rm.scores.has(pid)) rm.scores.set(pid, 0);
    }

    socket.emit("joined", { room: rm.code, pid });
    io.to(rm.code).emit("presence", { type: "join", id: pid, name: rm.players.get(pid).name });
    emitPlayers(rm);
  });

  socket.on("name:set", ({ room, name }) => {
    const rm = getRoom(room || socket.data.room);
    const pid = socket.data.pid;
    const p = rm.players.get(pid);
    if (p) {
      p.name = String(name || "Player").slice(0, 20);
      emitPlayers(rm);
    }
  });

  socket.on("chat", ({ room, user, text }) => {
    const rm = getRoom(room || socket.data.room);
    io.to(rm.code).emit("chat", { user, text, ts: Date.now() });
  });

  socket.on("secret:commit", ({ room, commit }) => {
    const rm = getRoom(room || socket.data.room);
    const pid = socket.data.pid;
    rm.commits.set(pid, commit);
    rm.secrets.delete(pid);
    rm.nonces.delete(pid);
    rm.revealed.delete(pid);
  });

  socket.on("secret:reveal", ({ room, secret, nonce }) => {
    const rm = getRoom(room || socket.data.room);
    const pid = socket.data.pid;
    const commit = rm.commits.get(pid);
    if (!commit) return;
    if (sha256Hex(`${secret}:${nonce}`) !== commit) return;
    rm.secrets.set(pid, secret);
    rm.nonces.set(pid, nonce);
    rm.revealed.add(pid);
    maybeResult(rm);
  });

  socket.on("guess:submit", ({ room, guess }) => {
    const rm = getRoom(room || socket.data.room);
    const pid = socket.data.pid;
    if (rm.submitted.has(pid)) return;
    rm.guesses.set(pid, guess);
    rm.submitted.add(pid);
    const act = activePair(rm);
    if (act.length === 2) io.to(rm.code).emit("reveal:request");
    maybeResult(rm);
  });

  socket.on("round:new", ({ room }) => {
    const rm = getRoom(room || socket.data.room);
    rm.round += 1;
    rm.commits.clear();
    rm.secrets.clear();
    rm.nonces.clear();
    rm.guesses.clear();
    rm.submitted.clear();
    rm.revealed.clear();
    rm.resultEmittedFor.delete(rm.round);
    io.to(rm.code).emit("round:reset");
  });

  socket.on("disconnect", () => {
    const rm = getRoom(socket.data.room || "");
    const pid = socket.data.pid;
    if (!rm || !pid) return;
    const p = rm.players.get(pid);
    if (p) {
      p.online = false;
      io.to(rm.code).emit("presence", { type: "leave", id: pid, name: p.name });
      emitPlayers(rm);
    }
  });
});

function activePair(rm) {
  const pids = Array.from(rm.players.keys());
  return pids
    .filter((pid) => rm.submitted.has(pid) && rm.revealed.has(pid) && rm.guesses.has(pid) && rm.secrets.has(pid))
    .slice(0, 2);
}

function maybeResult(rm) {
  const pair = activePair(rm);
  if (pair.length !== 2) return;
  if (rm.resultEmittedFor.has(rm.round)) return;

  const [A, B] = pair;
  const a = { pid: A, secret: rm.secrets.get(A), guess: rm.guesses.get(A) };
  const b = { pid: B, secret: rm.secrets.get(B), guess: rm.guesses.get(B) };
  if (!a.secret || !b.secret || !a.guess || !b.guess) return;

  rm.resultEmittedFor.add(rm.round);

  const aCorrect = a.guess === b.secret;
  const bCorrect = b.guess === a.secret;
  if (aCorrect) rm.scores.set(A, (rm.scores.get(A) || 0) + 1);
  if (bCorrect) rm.scores.set(B, (rm.scores.get(B) || 0) + 1);

  emitPlayers(rm);

  const sockA = rm.players.get(A)?.socketId;
  const sockB = rm.players.get(B)?.socketId;

  if (sockA)
    io.to(sockA).emit("round:result", {
      you: { secret: a.secret, guess: a.guess, correct: aCorrect },
      opponent: { secret: b.secret, guess: b.guess, correct: bCorrect },
    });
  if (sockB)
    io.to(sockB).emit("round:result", {
      you: { secret: b.secret, guess: b.guess, correct: bCorrect },
      opponent: { secret: a.secret, guess: a.guess, correct: aCorrect },
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rivals Guess-Who on :${PORT}`));
