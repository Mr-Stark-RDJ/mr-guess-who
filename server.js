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

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function roomState(room){
  if(!rooms.has(room)){
    rooms.set(room, {
      commits:{},
      guesses:{},
      secrets:{},
      reveals:{},
      players:{},   // socketId -> {name, online:true}
      scores:{}     // socketId -> number
    });
  }
  return rooms.get(room);
}

function sha(x){ return crypto.createHash("sha256").update(x).digest("hex"); }

function broadcastPlayers(room){
  const s = roomState(room);
  const players = Object.entries(s.players).map(([id,info])=>({id, name: info.name||"Player", online: !!info.online}));
  io.to(room).emit("players", { players, scores: s.scores });
}

function tryRequestReveal(room){
  const s = roomState(room);
  const haveCommits = Object.keys(s.commits).length >= 2;
  const haveGuesses = Object.keys(s.guesses).length >= 2;
  if(haveCommits && haveGuesses) io.to(room).emit("reveal:request");
}

function tryResolve(room){
  const s = roomState(room);
  const ids = Object.keys(s.secrets);
  if(ids.length < 2) return;
  const [p1,p2] = ids;
  const r = (me,opp)=>({
    you:{secret:s.secrets[me], guess:s.guesses[me], correct:s.guesses[me]===s.secrets[opp]},
    opponent:{secret:s.secrets[opp], guess:s.guesses[opp], correct:s.guesses[opp]===s.secrets[me]}
  });
  const res1 = r(p1,p2);
  const res2 = r(p2,p1);

  if(res1.you.correct) s.scores[p1] = (s.scores[p1]||0)+1;
  if(res2.you.correct) s.scores[p2] = (s.scores[p2]||0)+1;

  io.to(p1).emit("round:result", res1);
  io.to(p2).emit("round:result", res2);
  io.to(room).emit("score:update", { scores: s.scores });

  // clear round (keep players & scores)
  s.commits = {}; s.guesses = {}; s.secrets = {}; s.reveals = {};
}

io.on("connection", socket => {
  socket.on("join", room => {
    if(!room) return;
    socket.join(room);
    socket.data.room = room;

    const s = roomState(room);
    if(!s.players[socket.id]) s.players[socket.id] = { name: null, online:true };
    s.players[socket.id].online = true;
    if(s.scores[socket.id]==null) s.scores[socket.id] = 0;

    socket.emit("joined", { room });
    io.to(room).emit("presence", { type:"join", id: socket.id, name: s.players[socket.id].name || "Someone" });
    broadcastPlayers(room);
  });

  socket.on("name:set", ({room, name})=>{
    if(!room || !name) return;
    const s = roomState(room);
    if(!s.players[socket.id]) s.players[socket.id] = { name:null, online:true };
    s.players[socket.id].name = String(name).slice(0,20);
    s.players[socket.id].online = true;
    if(s.scores[socket.id]==null) s.scores[socket.id] = 0;
    io.to(room).emit("presence", { type:"name", id: socket.id, name: s.players[socket.id].name });
    broadcastPlayers(room);
  });

  socket.on("chat", ({room,user,text})=>{
    if(!room||!text) return;
    io.to(room).emit("chat", { user, text, ts: Date.now() });
  });

  socket.on("secret:commit", ({room,commit})=>{
    if(!room||!commit) return;
    const s = roomState(room);
    s.commits[socket.id] = commit;
    tryRequestReveal(room);
  });

  socket.on("guess:submit", ({room,guess})=>{
    if(!room||!guess) return;
    const s = roomState(room);
    s.guesses[socket.id] = guess;
    tryRequestReveal(room);
  });

  socket.on("secret:reveal", ({room,secret,nonce})=>{
    if(!room||!secret||!nonce) return;
    const s = roomState(room);
    const ok = s.commits[socket.id] && s.commits[socket.id] === sha(`${secret}:${nonce}`);
    if(!ok) return;
    s.secrets[socket.id] = secret;
    s.reveals[socket.id] = true;
    tryResolve(room);
  });

  socket.on("round:new", ({room})=>{
    if(!room) return;
    const s = roomState(room);
    s.commits = {}; s.guesses = {}; s.secrets = {}; s.reveals = {};
    io.to(room).emit("round:reset");
  });

  socket.on("disconnect", ()=>{
    const room = socket.data.room;
    if(!room) return;
    const s = roomState(room);
    if(s.players[socket.id]){
      s.players[socket.id].online = false;
      io.to(room).emit("presence", { type:"leave", id: socket.id, name: s.players[socket.id].name || "Someone" });
      broadcastPlayers(room);
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port);
