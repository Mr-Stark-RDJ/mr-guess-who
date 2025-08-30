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

function getRoom(r){
  if(!rooms.has(r)) rooms.set(r, { commits:{}, guesses:{}, secrets:{}, reveals:{} });
  return rooms.get(r);
}
function sha(x){ return crypto.createHash("sha256").update(x).digest("hex"); }
function tryRequestReveal(room){
  const s = getRoom(room);
  const a = Object.keys(s.commits);
  const g = Object.keys(s.guesses);
  if(a.length>=2 && g.length>=2) io.to(room).emit("reveal:request");
}
function tryResolve(room){
  const s = getRoom(room);
  const ids = Object.keys(s.secrets);
  if(ids.length<2) return;
  const [p1,p2] = ids;
  const r = (me,opp) => ({
    you:{secret:s.secrets[me], guess:s.guesses[me], correct:s.guesses[me]===s.secrets[opp]},
    opponent:{secret:s.secrets[opp], guess:s.guesses[opp], correct:s.guesses[opp]===s.secrets[me]}
  });
  io.to(p1).emit("round:result", r(p1,p2));
  io.to(p2).emit("round:result", r(p2,p1));
  rooms.set(room, { commits:{}, guesses:{}, secrets:{}, reveals:{} });
  io.to(room).emit("round:reset");
}

io.on("connection", socket => {
  socket.on("join", room => { if(!room) return; socket.join(room); socket.emit("joined",{room}); });
  socket.on("chat", ({room,user,text}) => { if(!room||!text) return; io.to(room).emit("chat", {user,text,ts:Date.now()}); });

  socket.on("secret:commit", ({room,commit}) => {
    if(!room||!commit) return;
    const s=getRoom(room); s.commits[socket.id]=commit; tryRequestReveal(room);
  });

  socket.on("guess:submit", ({room,guess}) => {
    if(!room||!guess) return;
    const s=getRoom(room); s.guesses[socket.id]=guess; tryRequestReveal(room);
  });

  socket.on("secret:reveal", ({room,secret,nonce}) => {
    if(!room||!secret||!nonce) return;
    const s=getRoom(room);
    const ok = s.commits[socket.id] && s.commits[socket.id]===sha(`${secret}:${nonce}`);
    if(!ok) return;
    s.secrets[socket.id]=secret; s.reveals[socket.id]=true; tryResolve(room);
  });

  socket.on("disconnect", ()=>{});
});

const port = process.env.PORT || 3000;
server.listen(port);
