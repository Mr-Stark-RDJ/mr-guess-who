const board=document.getElementById("board");
const clearBtn=document.getElementById("clearBtn");
const toggleAllBtn=document.getElementById("toggleAllBtn");
const secretModeBtn=document.getElementById("secretModeBtn");
const lockSecretBtn=document.getElementById("lockSecretBtn");
const submitBtn=document.getElementById("submitBtn");
const hintText=document.getElementById("hintText");

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
const chatDot=document.getElementById("chatDot");

const resultModal=document.getElementById("resultModal");
const modalCard=document.getElementById("modalCard");
const modalTitle=document.getElementById("modalTitle");
const youSecret=document.getElementById("youSecret");
const youPick=document.getElementById("youPick");
const oppSecret=document.getElementById("oppSecret");
const oppPick=document.getElementById("oppPick");
const newGameBtn=document.getElementById("newGameBtn");
const closeModalBtn=document.getElementById("closeModalBtn");

const alertModal=document.getElementById("alertModal");
const alertBody=document.getElementById("alertBody");
const alertOkBtn=document.getElementById("alertOkBtn");

const nameModal=document.getElementById("nameModal");
const nameInput=document.getElementById("nameInput");
const saveNameBtn=document.getElementById("saveNameBtn");

const scoreList=document.getElementById("scoreList");
const playersOnline=document.getElementById("playersOnline");

let heroes=[];
let flipped=new Set();
let joinedRoom="";
let socket=null;
let secret=null;
let nonce=null;
let secretMode=false;
let committed=false;
let allHidden=false;
let myId=null;
let myName=localStorage.getItem("rivals_name")||"";

// ---------- Alert queue (fix for “OK does nothing”) ----------
let alertQueue=[], alertOpen=false;
function pushAlert(msg){
  if(!msg) return;
  alertQueue.push(msg);
  if(!alertOpen) showNextAlert();
}
function showNextAlert(){
  const next = alertQueue.shift();
  if(next){
    alertBody.textContent = next;
    alertModal.classList.remove("hidden");
    alertOpen = true;
  }else{
    alertModal.classList.add("hidden");
    alertOpen = false;
  }
}
if(alertOkBtn){
  alertOkBtn.onclick = showNextAlert;
  alertModal.addEventListener("click",e=>{ if(e.target===alertModal) showNextAlert(); });
  document.addEventListener("keydown",e=>{
    if(alertOpen && (e.key==="Enter"||e.key==="Escape")) showNextAlert();
  });
}
// -------------------------------------------------------------

function cardHTML(h){
  return `<div class="card" data-id="${h.id}">
    <div class="thumb">
      <img src="${h.img||("icons/"+h.slug+".png")}" alt="${h.name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/>
      <div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div>
    </div>
    <div class="meta">${h.name}</div>
  </div>`;
}

function render(){
  board.innerHTML=heroes.map(cardHTML).join("");
  board.querySelectorAll(".card").forEach(c=>{
    const id=c.dataset.id;
    if(flipped.has(id)) c.classList.add("off");
    if(secret===id) c.classList.add("is-secret");
    c.onclick=()=>{
      if(secretMode){ if(committed){pushAlert("Secret is locked."); return;} selectSecret(id); }
      else { toggle(id); }
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
  flipped = new Set(off?ids:[]);
  board.querySelectorAll(".card").forEach(c=> c.classList.toggle("off",off));
  allHidden=off;
  toggleAllBtn.textContent=allHidden?"Show All":"Hide All";
}
function clearFlips(){
  flipped.clear();
  board.querySelectorAll(".card").forEach(c=> c.classList.remove("off"));
  allHidden=false;
  toggleAllBtn.textContent="Hide All";
}
function onlyOn(){ for(const h of heroes){ if(!flipped.has(h.id)) return h.id; } return null; }
function drawSecret(){
  if(!secret){ secretSlot.textContent="Not selected"; lockSecretBtn.disabled=true; return; }
  const h=heroes.find(x=>x.id===secret);
  secretSlot.innerHTML=`<div class="card"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}"/></div><div class="meta">${h.name}</div></div>`;
}

function tenc(n){ return n.toString(16).padStart(2,"0"); }
function randHex(len=16){ const a=new Uint8Array(len); crypto.getRandomValues(a); return Array.from(a).map(tenc).join(""); }
async function sha256Hex(s){ const d=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map(tenc).join(""); }

function ensureSocket(){
  if(socket) return;
  socket = io();

  socket.on("connect", ()=>{ myId = socket.id; });

  socket.on("joined", ({room})=>{
    roomStatus.textContent=`Joined ${room}`;
    // Secret-mode ON by default; pulse "Lock Secret"
    secretMode=true;
    secretModeBtn.textContent="Secret Mode: ON";
    lockSecretBtn.classList.add("btn-pulse");
    hintText.textContent="Pick a secret, then press Lock Secret to start.";
    pushAlert(`Joined room ${room}. Pick your secret and lock it.`);
    if(!myName) openNameModal();
    else socket.emit("name:set",{room:joinedRoom,name:myName});
  });

  // De-duplicate & soften presence updates (no blocking modal)
  socket.on("presence", ({type,id,name})=>{
    if(id===myId) return; // ignore our own presence
    const msg = type==="join" ? "joined" : (type==="leave" ? "left" : "is here");
    roomStatus.textContent = `${name} ${msg}.`;
    setTimeout(()=>{ roomStatus.textContent=`Joined ${joinedRoom}`; }, 1800);
  });

  socket.on("players", ({players, scores})=>{
    renderScores(players, scores);
  });

  socket.on("chat", m=>{
    addMsg(m);
    if(document.activeElement!==chatText && !nearBottom(chatLog)){
      chatDot.classList.remove("hidden");
    }
  });

  socket.on("reveal:request", ()=>{
    if(committed && secret && nonce) socket.emit("secret:reveal",{room:joinedRoom,secret,nonce});
  });

  socket.on("round:result", p=>showResults(p));

  socket.on("round:reset", ()=>{
    committed=false; secret=null; nonce=null; drawSecret();
    board.querySelectorAll(".card").forEach(c=>c.classList.remove("is-secret"));
    // Prep next round
    secretMode=true;
    secretModeBtn.textContent="Secret Mode: ON";
    lockSecretBtn.disabled=true;
    lockSecretBtn.classList.add("btn-pulse");
    hintText.textContent="Pick a secret, then press Lock Secret to start.";
    clearFlips();
  });
}

function renderScores(players, scores){
  playersOnline.textContent = `(${players.filter(p=>p.online).length} online)`;
  scoreList.innerHTML = players.map(p=>{
    const me = p.id===myId ? "me" : "";
    const pts = scores[p.id] || 0;
    return `<li class="scoreItem ${me}">
      <span class="name"><span class="status ${p.online?'on':'off'}"></span>${p.name || 'Player'}${me?' (you)':''}</span>
      <span class="pts">${pts}</span>
    </li>`;
  }).join("");
}

function addMsg(m){
  const d=new Date(m.ts||Date.now());
  const e=document.createElement("div");
  e.className="msg";
  e.innerHTML=`<span class='u'>${m.user||"Player"}</span> <span class='t'>${m.text}</span><span class='time' style='float:right;color:#79cda7;font-size:10px'>${d.toLocaleTimeString()}</span>`;
  chatLog.appendChild(e); chatLog.scrollTop=chatLog.scrollHeight;
}
function nearBottom(el){ return (el.scrollHeight - el.scrollTop - el.clientHeight) < 6; }

function sendChat(){
  const text=chatText.value.trim(); if(!text||!joinedRoom) return;
  const user=chatUser.value.trim()||myName||"Player";
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
  if(!joinedRoom){pushAlert("Join a room first.");return;}
  if(!secret){pushAlert("Pick a secret in Secret Mode.");return;}
  nonce = randHex(16);
  const commit = await sha256Hex(`${secret}:${nonce}`);
  ensureSocket();
  socket.emit("secret:commit",{room:joinedRoom,commit});
  committed=true; secretMode=false; secretModeBtn.textContent="Secret Mode: OFF"; lockSecretBtn.disabled=true;
  lockSecretBtn.classList.remove("btn-pulse");
  hintText.textContent="Secret locked. Hide characters and submit your guess.";
  roomStatus.textContent="Secret locked. Waiting for both guesses.";
}

function submitGuess(){
  const onCount = heroes.length - flipped.size;
  if(onCount!==1){pushAlert("Keep only one hero visible to submit your guess.");return;}
  const id = onlyOn(); if(!id||!joinedRoom){pushAlert("Join a room first.");return;}
  ensureSocket(); socket.emit("guess:submit",{room:joinedRoom,guess:id});
  roomStatus.textContent="Guess submitted. Waiting…";
}

function showResults(p){
  const youOk = p.you.correct;
  modalCard.classList.toggle("win", youOk);
  modalCard.classList.toggle("lose", !youOk);
  modalTitle.textContent = youOk ? "Victory" : "Defeat";

  youSecret.innerHTML = `<div class="pic"><img src="${imgFor(p.you.secret)}"/></div><div class="name">Your secret: ${nameFor(p.you.secret)}</div>`;
  oppSecret.innerHTML = `<div class="pic"><img src="${imgFor(p.opponent.secret)}"/></div><div class="name">Opponent’s secret: ${nameFor(p.opponent.secret)}</div>`;

  youPick.textContent = `Your pick: ${nameFor(p.you.guess)}`;
  oppPick.textContent = `Opponent pick: ${nameFor(p.opponent.guess)}`;

  resultModal.classList.remove("hidden");
}
function nameFor(id){const h=heroes.find(x=>x.id===id); return h?h.name:id;}
function imgFor(id){const h=heroes.find(x=>x.id===id); return h?(h.img||("icons/"+h.slug+".png")):"";}
function closeResults(){ resultModal.classList.add("hidden"); }

fetch("/heroes.json").then(r=>r.json()).then(json=>{heroes=json; render();});

clearBtn.onclick=clearFlips;
toggleAllBtn.onclick=()=>setAll(!allHidden);
secretModeBtn.onclick=()=>{ if(committed){pushAlert("Secret is locked.");return;} secretMode=!secretMode; secretModeBtn.textContent=secretMode?"Secret Mode: ON":"Secret Mode: OFF"; };
lockSecretBtn.onclick=lockSecret;
submitBtn.onclick=submitGuess;

joinBtn.onclick=join;
createBtn.onclick=create;
copyLinkBtn.onclick=copyInvite;

chatSend.onclick=sendChat;
chatText.addEventListener("keydown",e=>{if(e.key==="Enter") sendChat();});
chatText.addEventListener("focus",()=>chatDot.classList.add("hidden"));
chatLog.addEventListener("scroll",()=>{ if(nearBottom(chatLog)) chatDot.classList.add("hidden"); });

newGameBtn.onclick=()=>{
  if(joinedRoom && socket){ socket.emit("round:new",{room:joinedRoom}); }
  closeResults();
};
closeModalBtn.onclick=closeResults;

saveNameBtn.onclick=()=>{
  const n = nameInput.value.trim() || "Player";
  myName = n.slice(0,20);
  localStorage.setItem("rivals_name", myName);
  chatUser.value = myName;
  nameModal.classList.add("hidden");
  if(joinedRoom && socket) socket.emit("name:set",{room:joinedRoom,name:myName});
};

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom){roomInput.value=urlRoom.toUpperCase(); join();}
if(myName) chatUser.value=myName;
