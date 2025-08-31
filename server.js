const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

function sha256Hex(s){
  return crypto.createHash("sha256").update(s).digest("hex");
}

const rooms = new Map();
// room shape:
// {
//   code,
//   players: Map<socketId,{id,name,online:true}>,
//   scores: Map<socketId,number>,
//   commits: Map<socketId,string>,
//   secrets: Map<socketId,string>,
//   nonces: Map<socketId,string>,
//   guesses: Map<socketId,string>,
//   submitted: Set<socketId>,
//   revealed: Set<socketId>,
//   round: number,
//   resultEmittedFor: Set<number>
// }

function getRoom(code){
  code = code.toUpperCase();
  if(!rooms.has(code)){
    rooms.set(code,{
      code,
      players:new Map(),
      scores:new Map(),
      commits:new Map(),
      secrets:new Map(),
      nonces:new Map(),
      guesses:new Map(),
      submitted:new Set(),
      revealed:new Set(),
      round:1,
      resultEmittedFor:new Set()
    });
  }
  return rooms.get(code);
}

function emitPlayers(rm){
  const players = Array.from(rm.players.values());
  const scores = Object.fromEntries(Array.from(rm.scores.entries()));
  io.to(rm.code).emit("players",{players,scores});
}

io.on("connection",(socket)=>{
  let myRoom = null;

  socket.on("join",(code)=>{
    myRoom = getRoom(code);
    socket.join(myRoom.code);
    myRoom.players.set(socket.id,{id:socket.id,name:"Player",online:true});
    if(!myRoom.scores.has(socket.id)) myRoom.scores.set(socket.id,0);
    socket.emit("joined",{room:myRoom.code});
    io.to(myRoom.code).emit("presence",{type:"join",id:socket.id,name:myRoom.players.get(socket.id).name});
    emitPlayers(myRoom);
  });

  socket.on("name:set",({room,name})=>{
    const rm = getRoom(room);
    const p = rm.players.get(socket.id);
    if(p){ p.name = String(name||"Player").slice(0,20); emitPlayers(rm); }
  });

  socket.on("chat",({room,user,text})=>{
    const rm = getRoom(room);
    io.to(rm.code).emit("chat",{user,text,ts:Date.now()});
  });

  socket.on("secret:commit",({room,commit})=>{
    const rm = getRoom(room);
    rm.commits.set(socket.id,commit);
    rm.secrets.delete(socket.id);
    rm.nonces.delete(socket.id);
    rm.revealed.delete(socket.id);
  });

  socket.on("secret:reveal",({room,secret,nonce})=>{
    const rm = getRoom(room);
    const commit = rm.commits.get(socket.id);
    if(!commit) return;
    const ok = sha256Hex(`${secret}:${nonce}`) === commit;
    if(!ok) return;
    rm.secrets.set(socket.id,secret);
    rm.nonces.set(socket.id,nonce);
    rm.revealed.add(socket.id);
    maybeResult(rm);
  });

  socket.on("guess:submit",({room,guess})=>{
    const rm = getRoom(room);
    if(rm.submitted.has(socket.id)) return; // prevent double-submits → double points
    rm.guesses.set(socket.id,guess);
    rm.submitted.add(socket.id);
    // when everyone submitted, ask both to reveal
    if(rm.submitted.size >= Math.min(2, rm.players.size)){
      io.to(rm.code).emit("reveal:request");
    }
    maybeResult(rm);
  });

  socket.on("round:new",({room})=>{
    const rm = getRoom(room);
    rm.round += 1;
    rm.commits.clear(); rm.secrets.clear(); rm.nonces.clear();
    rm.guesses.clear(); rm.submitted.clear(); rm.revealed.clear();
    io.to(rm.code).emit("round:reset");
  });

  socket.on("disconnect",()=>{
    if(!myRoom) return;
    const p = myRoom.players.get(socket.id);
    if(p){ p.online=false; io.to(myRoom.code).emit("presence",{type:"leave",id:socket.id,name:p.name}); }
    emitPlayers(myRoom);
  });

  function maybeResult(rm){
    const need = Math.min(2, rm.players.size);
    if(rm.submitted.size < need) return;
    if(rm.revealed.size < need) return;

    if(rm.resultEmittedFor.has(rm.round)) return; // already scored this round
    rm.resultEmittedFor.add(rm.round);

    const playerIds = Array.from(rm.players.keys()).slice(0,2);
    if(playerIds.length<2){ return; }

    const [a,b] = playerIds;
    const pa = { id:a, secret: rm.secrets.get(a), guess: rm.guesses.get(a) };
    const pb = { id:b, secret: rm.secrets.get(b), guess: rm.guesses.get(b) };

    const aCorrect = pa.guess === pb.secret;
    const bCorrect = pb.guess === pa.secret;

    if(aCorrect) rm.scores.set(a, (rm.scores.get(a)||0)+1);
    if(bCorrect) rm.scores.set(b, (rm.scores.get(b)||0)+1);

    emitPlayers(rm);

    io.to(a).emit("round:result",{
      you:{secret:pa.secret,guess:pa.guess,correct:aCorrect},
      opponent:{secret:pb.secret,guess:pb.guess,correct:bCorrect}
    });
    io.to(b).emit("round:result",{
      you:{secret:pb.secret,guess:pb.guess,correct:bCorrect},
      opponent:{secret:pa.secret,guess:pa.guess,correct:aCorrect}
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`Rivals Guess-Who on :${PORT}`));
