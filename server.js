import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname, "public")));
const rooms = new Map();
function getRoom(r){ if(!rooms.has(r)) rooms.set(r,{flipped:new Set()}); return rooms.get(r); }
io.on("connection", socket => {
  socket.on("join", r => { if(!r) return; socket.join(r); const s=getRoom(r); socket.emit("state", Array.from(s.flipped)); });
  socket.on("flip", ({room,id,off}) => { if(!room||!id) return; const s=getRoom(room); if(off) s.flipped.add(id); else s.flipped.delete(id); io.to(room).emit("flip", {id,off}); });
  socket.on("bulk", ({room,ids,off}) => { if(!room||!Array.isArray(ids)) return; const s=getRoom(room); ids.forEach(x=> off?s.flipped.add(x):s.flipped.delete(x)); io.to(room).emit("bulk", {ids,off}); });
  socket.on("reset", ({room}) => { if(!room) return; const s=getRoom(room); s.flipped.clear(); io.to(room).emit("reset"); });
  socket.on("chat", ({room,user,text}) => { if(!room||!text) return; io.to(room).emit("chat", {user,text,ts:Date.now()}); });
});
const port = process.env.PORT || 3000;
server.listen(port);
