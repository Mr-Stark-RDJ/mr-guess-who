// ===== DOM =====
const board = document.getElementById("board");

const clearBtn = document.getElementById("clearBtn");
const toggleAllBtn = document.getElementById("toggleAllBtn");
const secretModeBtn = document.getElementById("secretModeBtn");
const lockSecretBtn = document.getElementById("lockSecretBtn");
const submitBtn = document.getElementById("submitBtn");

const hintText = document.getElementById("hintText");
const secretSlot = document.getElementById("secretSlot");

const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const roomStatus = document.getElementById("roomStatus");

const chatLog = document.getElementById("chatLog");
const chatText = document.getElementById("chatText");
const chatSend = document.getElementById("chatSend");
const chatUser = document.getElementById("chatUser");
const chatDot = document.getElementById("chatDot");

const resultModal = document.getElementById("resultModal");
const modalCard = document.getElementById("modalCard");
const modalTitle = document.getElementById("modalTitle");
const youSecret = document.getElementById("youSecret");
const youPick = document.getElementById("youPick");
const oppSecret = document.getElementById("oppSecret");
const oppPick = document.getElementById("oppPick");
const newGameBtn = document.getElementById("newGameBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

const alertModal = document.getElementById("alertModal");
const alertBody = document.getElementById("alertBody");
const alertOkBtn = document.getElementById("alertOkBtn");

const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const saveNameBtn = document.getElementById("saveNameBtn");

const scoreList = document.getElementById("scoreList");
const playersOnline = document.getElementById("playersOnline");

const toasts = document.getElementById("toasts");
const chatFloat = document.getElementById("chatFloat");

// ===== State =====
let heroes = [];
let flipped = new Set();
let joinedRoom = "";
let socket = null;
let secret = null;
let nonce = null;

let secretMode = false;
let committed = false;
let guessSubmitted = false;
let allHidden = false;
let myId = null;

let myName = localStorage.getItem("rivals_name") || "";
let unread = 0;

// ===== Utils =====
function toast(msg, type = "info", ms = 2400) {
  if (!toasts) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  toasts.appendChild(t);
  setTimeout(() => { t.classList.add("hide"); setTimeout(() => t.remove(), 350); }, ms);
}

let alertQueue = [], alertOpen = false;
function pushAlert(msg){ if(!msg) return; alertQueue.push(msg); if(!alertOpen) showNextAlert(); }
function showNextAlert(){
  const n = alertQueue.shift();
  if(n){ alertBody.textContent = n; alertModal.classList.remove("hidden"); alertOpen = true; }
  else { alertModal.classList.add("hidden"); alertOpen = false; }
}
alertOkBtn.onclick = showNextAlert;
alertModal.addEventListener("click",e=>{ if(e.target===alertModal) showNextAlert(); });
document.addEventListener("keydown",e=>{ if(alertOpen&&(e.key==="Enter"||e.key==="Escape")) showNextAlert(); });

const tenc = n => n.toString(16).padStart(2,"0");
const randHex = (len=16)=>{ const a=new Uint8Array(len); crypto.getRandomValues(a); return Array.from(a).map(tenc).join(""); };
async function sha256Hex(s){ const d=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map(tenc).join(""); }

const nearBottom = el => el && (el.scrollHeight - el.scrollTop - el.clientHeight) < 6;
function isInView(el){ if(!el) return false; const r=el.getBoundingClientRect(); const h=innerHeight||document.documentElement.clientHeight; return r.top>=0&&r.bottom<=h; }

// ===== Board render =====
function cardHTML(h){
  return `<div class="card" data-id="${h.id}">
    <div class="thumb">
      <img src="${h.img || ("icons/"+h.slug+".png")}" alt="${h.name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/>
      <div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div>
    </div>
    <div class="meta">${h.name}</div>
  </div>`;
}

function render(){
  board.innerHTML = heroes.map(cardHTML).join("");
  board.querySelectorAll(".card").forEach(c=>{
    const id=c.dataset.id;
    if(flipped.has(id)) c.classList.add("off");
    if(secret===id) c.classList.add("is-secret");
    c.onclick=()=>{
      if(secretMode){
        if(committed){ pushAlert("Secret is locked."); return; }
        selectSecret(id);
      }else{
        toggle(id);
      }
    };
  });
  drawSecret();
}

function selectSecret(id){
  secret=id;
  board.querySelectorAll(".card").forEach(x=>x.classList.remove("is-secret"));
  const el=board.querySelector(`.card[data-id="${id}"]`);
  if(el) el.classList.add("is-secret");
  drawSecret();
  lockSecretBtn.disabled=false;
}
function toggle(id){
  if(flipped.has(id)) flipped.delete(id); else flipped.add(id);
  const el=board.querySelector(`.card[data-id="${id}"]`);
  if(el) el.classList.toggle("off",flipped.has(id));
}
function setAll(off){
  const ids=heroes.map(h=>h.id);
  flipped=new Set(off?ids:[]);
  board.querySelectorAll(".card").forEach(c=>c.classList.toggle("off",off));
  allHidden=off;
  toggleAllBtn.textContent=allHidden?"Show All":"Hide All";
}
function clearFlips(){
  flipped.clear();
  board.querySelectorAll(".card").forEach(c=>c.classList.remove("off"));
  allHidden=false;
  toggleAllBtn.textContent="Hide All";
}
function onlyOn(){ for(const h of heroes){ if(!flipped.has(h.id)) return h.id; } return null; }
function drawSecret(){
  if(!secret){ secretSlot.textContent="Not selected"; lockSecretBtn.disabled=true; return; }
  const h=heroes.find(x=>x.id===secret);
  secretSlot.innerHTML=`<div class="card"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}"/></div><div class="meta">${h.name}</div></div>`;
}

// ===== Socket / multiplayer =====
function ensureSocket(){
  if(socket) return;
  socket=io();

  socket.on("connect",()=>{ myId=socket.id; });

  socket.on("joined",({room})=>{
    roomStatus.textContent=`Joined ${room}`;
    secretMode=true;
    secretModeBtn.textContent="Secret Mode: ON";
    lockSecretBtn.classList.add("btn-pulse");
    if(hintText) hintText.textContent="Pick a secret, then press Lock Secret to start.";
    toast(`Joined ${room}`,"info",1800);
    if(!myName) nameModal.classList.remove("hidden");
    else socket.emit("name:set",{room:joinedRoom,name:myName});
  });

  socket.on("players",({players,scores})=>renderScores(players,scores));

  socket.on("presence",({type,id,name})=>{
    if(id===myId) return;
    const m = type==="join"?"joined":(type==="leave"?"left":"is here");
    toast(`${name} ${m}`,"info",1800);
  });

  socket.on("chat",m=>{
    const wasBottom=nearBottom(chatLog);
    const visible=isInView(chatLog);
    addMsg(m,wasBottom&&visible);
    const need=(!visible||!wasBottom||document.activeElement!==chatText);
    if(need){
      chatDot.classList.remove("hidden");
      unread++;
      chatFloat.textContent=`Chat (${unread})`;
      chatFloat.classList.remove("hidden");
      toast(`${m.user||"Player"}: ${m.text}`,"chat",3000);
    }
  });

  socket.on("reveal:request",()=>{ if(committed && secret && nonce){ socket.emit("secret:reveal",{room:joinedRoom,secret,nonce}); } });

  socket.on("round:result",p=>showResults(p));

  socket.on("round:reset",()=>{
    committed=false; secret=null; nonce=null; guessSubmitted=false;
    drawSecret();
    board.querySelectorAll(".card").forEach(c=>c.classList.remove("is-secret"));
    secretMode=true; secretModeBtn.textContent="Secret Mode: ON";
    lockSecretBtn.disabled=true; lockSecretBtn.classList.add("btn-pulse");
    if(hintText) hintText.textContent="Pick a secret, then press Lock Secret to start.";
    clearFlips();
    submitBtn.disabled=false; submitBtn.textContent="Submit Guess";
  });
}

function renderScores(players,scores){
  playersOnline.textContent=`(${players.filter(p=>p.online).length} online)`;
  scoreList.innerHTML=players.map(p=>{
    const me=p.id===myId?"me":"",pts=scores[p.id]||0;
    return `<li class="scoreItem ${me}">
      <span class="name"><span class="status ${p.online?'on':'off'}"></span>${p.name||'Player'}${me?' (you)':''}</span>
      <span class="pts">${pts}</span>
    </li>`;
  }).join("");
}

// ===== Chat UI =====
function addMsg(m,scroll){
  const d=new Date(m.ts||Date.now());
  const e=document.createElement("div");
  e.className="msg";
  e.innerHTML=`<span class='u'>${m.user||"Player"}</span><span class='t'>${m.text}</span><span class='time'>${d.toLocaleTimeString()}</span>`;
  chatLog.appendChild(e);
  if(scroll) chatLog.scrollTop=chatLog.scrollHeight;
}

// ===== Room controls =====
function join(){
  const r=(roomInput.value||"").trim().toUpperCase();
  if(!r) return;
  ensureSocket();
  joinedRoom=r;
  socket.emit("join",r);
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
  navigator.clipboard?.writeText(url);
  roomStatus.textContent=`Joined ${joinedRoom}`;
  toast("Link copied","info",1200);
}

// ===== Game actions =====
async function lockSecret(){
  if(!joinedRoom){ pushAlert("Join a room first."); return; }
  if(!secret){ pushAlert("Pick a secret in Secret Mode."); return; }
  nonce=randHex(16);
  const commit=await sha256Hex(`${secret}:${nonce}`);
  ensureSocket();
  socket.emit("secret:commit",{room:joinedRoom,commit});
  committed=true; secretMode=false;
  secretModeBtn.textContent="Secret Mode: OFF";
  lockSecretBtn.disabled=true; lockSecretBtn.classList.remove("btn-pulse");
  roomStatus.textContent=`Joined ${joinedRoom}`;
}

function submitGuess(){
  const onCount=heroes.length-flipped.size;
  if(onCount!==1){ pushAlert("Keep only one hero visible to submit your guess."); return; }
  if(guessSubmitted){ return; }
  const id=onlyOn();
  if(!id||!joinedRoom){ pushAlert("Join a room first."); return; }
  ensureSocket();
  socket.emit("guess:submit",{room:joinedRoom,guess:id});
  guessSubmitted=true;
  submitBtn.disabled=true;
  submitBtn.textContent="Submitted";
  toast("Guess submitted","info",1200);
}

// ===== Results modal (order: Opponent’s secret + Your pick  |  Your secret + Opponent pick) =====
function showResults(p){
  const win=p.you.correct;
  modalCard.classList.toggle("win",win);
  modalCard.classList.toggle("lose",!win);
  modalTitle.textContent=win?"Victory":"Defeat";

  // Left column: opponent’s secret + your pick
  oppSecret.innerHTML =
    `<div class="pic"><img src="${imgFor(p.opponent.secret)}"/></div>
     <div class="name">Opponent’s secret: ${nameFor(p.opponent.secret)}</div>`;
  youPick.textContent = `Your pick: ${nameFor(p.you.guess)}`;

  // Right column: your secret + opponent pick
  youSecret.innerHTML =
    `<div class="pic"><img src="${imgFor(p.you.secret)}"/></div>
     <div class="name">Your secret: ${nameFor(p.you.secret)}</div>`;
  oppPick.textContent = `Opponent pick: ${nameFor(p.opponent.guess)}`;

  resultModal.classList.remove("hidden");
}

function nameFor(id){ const h=heroes.find(x=>x.id===id); return h?h.name:id; }
function imgFor(id){ const h=heroes.find(x=>x.id===id); return h?(h.img||("icons/"+h.slug+".png")):""; }
function closeResults(){ resultModal.classList.add("hidden"); }

// ===== Boot =====
fetch("/heroes.json").then(r=>r.json()).then(json=>{ heroes=json; render(); });

clearBtn.onclick=clearFlips;
toggleAllBtn.onclick=()=>setAll(!allHidden);
secretModeBtn.onclick=()=>{ if(committed){ pushAlert("Secret is locked."); return; } secretMode=!secretMode; secretModeBtn.textContent=secretMode?"Secret Mode: ON":"Secret Mode: OFF"; };
lockSecretBtn.onclick=lockSecret;
submitBtn.onclick=submitGuess;

joinBtn.onclick=join; createBtn.onclick=create; copyLinkBtn.onclick=copyInvite;

chatSend.onclick=()=>{ const text=chatText.value.trim(); if(!text||!joinedRoom) return; const user=chatUser.value.trim()||myName||"Player"; socket.emit("chat",{room:joinedRoom,user,text}); chatText.value=""; };
chatText.addEventListener("keydown",e=>{ if(e.key==="Enter") chatSend.onclick(); });
chatText.addEventListener("focus",()=>{ chatDot.classList.add("hidden"); unread=0; chatFloat.classList.add("hidden"); });
chatLog.addEventListener("scroll",()=>{ if(nearBottom(chatLog)){ chatDot.classList.add("hidden"); unread=0; chatFloat.classList.add("hidden"); }});
chatFloat.onclick=()=>{ unread=0; chatFloat.classList.add("hidden"); chatDot.classList.add("hidden"); chatLog.scrollIntoView({behavior:"smooth",block:"end"}); chatText.focus(); };

newGameBtn.onclick=()=>{ if(joinedRoom&&socket) socket.emit("round:new",{room:joinedRoom}); closeResults(); };
closeModalBtn.onclick=closeResults;

saveNameBtn.onclick=()=>{ const n=nameInput.value.trim()||"Player"; myName=n.slice(0,20); localStorage.setItem("rivals_name",myName); chatUser.value=myName; nameModal.classList.add("hidden"); if(joinedRoom&&socket) socket.emit("name:set",{room:joinedRoom,name:myName}); };

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom){ roomInput.value=urlRoom.toUpperCase(); join(); }
if(myName) chatUser.value=myName;
