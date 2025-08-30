const board=document.getElementById("board");
const resetBtn=document.getElementById("resetBtn");
const allOnBtn=document.getElementById("allOnBtn");
const allOffBtn=document.getElementById("allOffBtn");
const exportBtn=document.getElementById("exportBtn");
const secretModeBtn=document.getElementById("secretModeBtn");
const lockSecretBtn=document.getElementById("lockSecretBtn");
const submitBtn=document.getElementById("submitBtn");
const secretSlot=document.getElementById("secretSlot");
const roomInput=document.getElementById("roomInput");
const joinBtn=document.getElementById("joinBtn");
const createBtn=document.getElementById("createBtn");
const copyLinkBtn=document.getElementById("copyLinkBtn");
const roomStatus=document.getElementById("roomStatus");
const chatLog=document.getElementById("chatLog");
const chatText=document.getElementById("chatText");
const chatSend=document.getElementById("chatSend");
const chatUser=document.getElementById("chatUser");

let heroes=[]; 
let flipped=new Set(); 
let joinedRoom=""; 
let socket=null; 
let secret=null; 
let nonce=null; 
let secretMode=false; 
let committed=false;

function cardHTML(h){
  return `<div class="card" data-id="${h.id}"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}" alt="${h.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/><div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div></div><div class="meta">${h.name}</div></div>`;
}
function render(){
  board.innerHTML=heroes.map(cardHTML).join("");
  board.querySelectorAll(".card").forEach(c=>{
    const id=c.dataset.id;
    if(flipped.has(id)) c.classList.add("off");
    c.onclick=()=>{ if(secretMode){ secret=id; secretSlot.textContent="Secret selected"; } else { toggle(id); } checkSubmitState(); };
  });
  checkSubmitState();
}
function toggle(id){
  if(flipped.has(id)) flipped.delete(id); else flipped.add(id);
  const el=board.querySelector(`.card[data-id="${id}"]`);
  if(el) el.classList.toggle("off",flipped.has(id));
}
function all(off){
  const ids=heroes.map(h=>h.id);
  flipped = new Set(off?ids:[]);
  board.querySelectorAll(".card").forEach(c=> c.classList.toggle("off",off));
  checkSubmitState();
}
function reset(){
  flipped.clear();
  board.querySelectorAll(".card").forEach(c=> c.classList.remove("off"));
  checkSubmitState();
}
function onlyOn(){
  for(const h of heroes){ if(!flipped.has(h.id)) return h.id; }
  return null;
}
function checkSubmitState(){
  const onCount = heroes.length - flipped.size;
  submitBtn.disabled = onCount!==1;
}
function tenc(n){ return n.toString(16).padStart(2,"0"); }
function randHex(len=16){ const a=new Uint8Array(len); crypto.getRandomValues(a); return Array.from(a).map(tenc).join(""); }
async function sha256Hex(s){ const d=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map(tenc).join(""); }

function ensureSocket(){
  if(socket) return;
  socket = io();
  socket.on("joined", ({room})=>{ roomStatus.textContent=`Joined ${room}`; });
  socket.on("chat", m=>addMsg(m));
  socket.on("reveal:request", ()=>{ if(committed && secret && nonce) socket.emit("secret:reveal",{room:joinedRoom,secret,nonce}); });
  socket.on("round:result", p=>{
    const you = p.you.correct ? "You WON" : "You LOST";
    const opp = heroes.find(x=>x.id===p.opponent.secret)?.name || p.opponent.secret;
    roomStatus.textContent=`${you}. Opponent's secret: ${opp}`;
  });
  socket.on("round:reset", ()=>{
    committed=false; secret=null; nonce=null; secretSlot.textContent="Not selected"; submitBtn.disabled=true;
  });
}

function addMsg(m){
  const d=new Date(m.ts||Date.now());
  const e=document.createElement("div");
  e.className="msg";
  e.innerHTML=`<span class='u'>${m.user||"Player"}</span> <span class='t'>${m.text}</span><span class='time' style='float:right;color:#79cda7;font-size:10px'>${d.toLocaleTimeString()}</span>`;
  chatLog.appendChild(e); chatLog.scrollTop=chatLog.scrollHeight;
}

function sendChat(){
  const text=chatText.value.trim(); if(!text||!joinedRoom) return;
  const user=chatUser.value.trim()||"Player";
  socket.emit("chat",{room:joinedRoom,user,text});
  chatText.value="";
}

function join(){
  const r=(roomInput.value||"").trim().toUpperCase(); if(!r) return;
  ensureSocket(); joinedRoom=r; socket.emit("join",r);
  history.replaceState(null,"",`/?room=${joinedRoom}`);
}

function create(){
  const s="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out=""; for(let i=0;i<6;i++) out+=s[Math.floor(Math.random()*s.length)];
  roomInput.value=out; join(); copyInvite();
}

function copyInvite(){
  if(!joinedRoom) return;
  const url=`${location.origin}/?room=${joinedRoom}`;
  if(navigator.clipboard) navigator.clipboard.writeText(url);
  roomStatus.textContent="Link copied";
  setTimeout(()=>roomStatus.textContent=`Joined ${joinedRoom}`,900);
}

async function lockSecret(){
  if(!joinedRoom) return;
  if(!secret){ secretSlot.textContent="Pick in Secret Mode"; return; }
  nonce = randHex(16);
  const commit = await sha256Hex(`${secret}:${nonce}`);
  ensureSocket();
  socket.emit("secret:commit",{room:joinedRoom,commit});
  committed=true; secretSlot.textContent="Locked ✓";
}

function submitGuess(){
  const id = onlyOn(); if(!id||!joinedRoom) return;
  ensureSocket(); socket.emit("guess:submit",{room:joinedRoom,guess:id});
  roomStatus.textContent="Guess submitted. Waiting for opponent…";
}

fetch("/heroes.json").then(r=>r.json()).then(json=>{heroes=json; render();});

resetBtn.onclick=reset;
allOnBtn.onclick=()=>all(false);
allOffBtn.onclick=()=>all(true);
exportBtn.onclick=()=>{
  const off=[...flipped]; const on=heroes.map(h=>h.id).filter(x=>!flipped.has(x));
  if(navigator.clipboard) navigator.clipboard.writeText(JSON.stringify({off,on},null,2));
  alert("State copied");
};
secretModeBtn.onclick=()=>{ secretMode=!secretMode; secretModeBtn.textContent=secretMode?"Secret Mode: ON":"Secret Mode: OFF"; };
lockSecretBtn.onclick=lockSecret;
submitBtn.onclick=submitGuess;

joinBtn.onclick=join;
createBtn.onclick=create;
copyLinkBtn.onclick=copyInvite;

chatSend.onclick=sendChat;
chatText.addEventListener("keydown",e=>{if(e.key==="Enter") sendChat();});

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom){roomInput.value=urlRoom.toUpperCase(); join();}
