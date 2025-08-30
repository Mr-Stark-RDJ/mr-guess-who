const board=document.getElementById("board");
const resetBtn=document.getElementById("resetBtn");
const allOnBtn=document.getElementById("allOnBtn");
const allOffBtn=document.getElementById("allOffBtn");
const exportBtn=document.getElementById("exportBtn");
const randomSecretBtn=document.getElementById("randomSecretBtn");
const clearSecretBtn=document.getElementById("clearSecretBtn");
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
const secretModeBtn=document.getElementById("secretModeBtn");

let heroes=[]; 
let flipped=new Set(); 
let joinedRoom=""; 
let socket=null; 
let secret=null; 
let secretMode=false;

function cardHTML(h){
  return `<div class="card" data-id="${h.id}"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}" alt="${h.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/><div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div></div><div class="meta">${h.name}</div></div>`;
}

function render(){
  board.innerHTML=heroes.map(cardHTML).join("");
  board.querySelectorAll(".card").forEach(c=>{
    const id=c.dataset.id;
    if(flipped.has(id)) c.classList.add("off");
    if(secret===id) c.classList.add("is-secret");
    c.onclick=()=>{ if(secretMode){ setSecret(id); } else { toggle(id); } };
  });
  drawSecret();
}

function toggle(id,remote){
  if(flipped.has(id)){flipped.delete(id); if(joinedRoom&&!remote) socket.emit("flip",{room:joinedRoom,id,off:false});}
  else{flipped.add(id); if(joinedRoom&&!remote) socket.emit("flip",{room:joinedRoom,id,off:true});}
  const el=board.querySelector(`.card[data-id="${id}"]`);
  if(el){el.classList.toggle("off",flipped.has(id));}
}

function all(off){
  const ids=heroes.map(h=>h.id);
  flipped = new Set(off?ids:[]);
  board.querySelectorAll(".card").forEach(c=> c.classList.toggle("off",off));
  if(joinedRoom) socket.emit("bulk",{room:joinedRoom,ids,off});
}

function reset(){
  flipped.clear();
  board.querySelectorAll(".card").forEach(c=> c.classList.remove("off"));
  if(joinedRoom) socket.emit("reset",{room:joinedRoom});
}

function setSecret(id){
  secret=id;
  board.querySelectorAll(".card").forEach(c=> c.classList.toggle("is-secret", c.dataset.id===id));
  drawSecret();
}

function drawSecret(){
  if(!secret){secretSlot.textContent="None";return;}
  const h=heroes.find(x=>x.id===secret);
  if(!h){secretSlot.textContent="None";return;}
  secretSlot.innerHTML=`<div class="card" style="width:120px"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}"/><div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div></div><div class="meta">${h.name}</div></div>`;
}

function exportState(){
  const off=[...flipped];
  const on=heroes.map(h=>h.id).filter(x=>!flipped.has(x));
  const data={off,on};
  if(navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(data,null,2));
  alert("State copied");
}

function join(){
  const r=(roomInput.value||"").trim().toUpperCase();
  if(!r) return;
  if(typeof io==="undefined") return;
  if(!socket) socket=io();
  joinedRoom=r;
  history.replaceState(null,"",`/?room=${joinedRoom}`);
  socket.emit("join",joinedRoom);
  roomStatus.textContent=`Joined ${joinedRoom}`;
  socket.on("state",arr=>{flipped=new Set(arr); render();});
  socket.on("flip",({id,off})=>{if(off) flipped.add(id); else flipped.delete(id); toggle(id,true);});
  socket.on("bulk",({ids,off})=>{ids.forEach(x=> off?flipped.add(x):flipped.delete(x)); render();});
  socket.on("reset",()=>{flipped.clear(); render();});
  socket.on("chat",m=>addMsg(m));
}

function addMsg(m){
  const d=new Date(m.ts||Date.now());
  const e=document.createElement("div");
  e.className="msg";
  e.innerHTML=`<span class='u'>${m.user||"Player"}</span><span class='t'>${m.text}</span><span class='time' style='float:right;color:#79cda7;font-size:10px'>${d.toLocaleTimeString()}</span>`;
  chatLog.appendChild(e);
  chatLog.scrollTop=chatLog.scrollHeight;
}

function sendChat(){
  const text=chatText.value.trim();
  if(!text) return;
  const user=chatUser.value.trim()||"Player";
  const m={room:joinedRoom,user,text};
  addMsg({...m,ts:Date.now()});
  chatText.value="";
  if(joinedRoom&&socket) socket.emit("chat",m);
}

function makeCode(n=6){
  const s="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out="";
  for(let i=0;i<n;i++) out+=s[Math.floor(Math.random()*s.length)];
  return out;
}

function copyInvite(){
  if(!joinedRoom) return;
  const url=`${location.origin}/?room=${joinedRoom}`;
  if(navigator.clipboard) navigator.clipboard.writeText(url);
  roomStatus.textContent="Link copied";
  setTimeout(()=>roomStatus.textContent=`Joined ${joinedRoom}`,900);
}

fetch("/heroes.json").then(r=>r.json()).then(json=>{heroes=json; render();});

resetBtn.onclick=reset;
allOnBtn.onclick=()=>all(false);
allOffBtn.onclick=()=>all(true);
exportBtn.onclick=exportState;
randomSecretBtn.onclick=()=>{
  if(!heroes.length) return;
  const pool=heroes.filter(h=>!flipped.has(h.id));
  const pick=pool[Math.floor(Math.random()*pool.length)]||heroes[0];
  setSecret(pick.id);
};
clearSecretBtn.onclick=()=>{secret=null; drawSecret(); board.querySelectorAll(".card").forEach(c=> c.classList.remove("is-secret"));};

joinBtn.onclick=join;
createBtn.onclick=()=>{roomInput.value=makeCode(); join(); copyInvite();};
copyLinkBtn.onclick=copyInvite;

secretModeBtn.onclick=()=>{
  secretMode=!secretMode;
  secretModeBtn.textContent=secretMode?"Secret Mode: ON":"Secret Mode: OFF";
  secretModeBtn.classList.toggle("active",secretMode);
};

chatSend.onclick=sendChat;
chatText.addEventListener("keydown",e=>{if(e.key==="Enter") sendChat();});

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom){roomInput.value=urlRoom.toUpperCase(); join();}
