const board=document.getElementById("board");
const clearBtn=document.getElementById("clearBtn");
const toggleAllBtn=document.getElementById("toggleAllBtn");
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
const resultModal=document.getElementById("resultModal");
const modalTitle=document.getElementById("modalTitle");
const youCard=document.getElementById("youCard");
const oppCard=document.getElementById("oppCard");
const youGuess=document.getElementById("youGuess");
const oppGuess=document.getElementById("oppGuess");
const playAgainBtn=document.getElementById("playAgainBtn");
const closeModalBtn=document.getElementById("closeModalBtn");
const alertModal=document.getElementById("alertModal");
const alertBody=document.getElementById("alertBody");
const alertOkBtn=document.getElementById("alertOkBtn");

let heroes=[]; 
let flipped=new Set(); 
let joinedRoom=""; 
let socket=null; 
let secret=null; 
let nonce=null; 
let secretMode=false; 
let committed=false; 
let allHidden=false;

function openAlert(msg){alertBody.textContent=msg; alertModal.classList.remove("hidden");}
function closeAlert(){alertModal.classList.add("hidden");}

function cardHTML(h){
  return `<div class="card" data-id="${h.id}">
    <div class="thumb">
      <img src="${h.img||("icons/"+h.slug+".png")}" alt="${h.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/>
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
      if(secretMode){ if(committed){openAlert("Secret is locked."); return;} selectSecret(id); } 
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

function onlyOn(){
  for(const h of heroes){ if(!flipped.has(h.id)) return h.id; }
  return null;
}

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
  socket.on("joined", ({room})=>{ roomStatus.textContent=`Joined ${room}`; });
  socket.on("chat", m=>addMsg(m));
  socket.on("reveal:request", ()=>{ if(committed && secret && nonce) socket.emit("secret:reveal",{room:joinedRoom,secret,nonce}); });
  socket.on("round:result", p=>showResults(p));
  socket.on("round:reset", ()=>{
    committed=false; secret=null; nonce=null; drawSecret();
    board.querySelectorAll(".card").forEach(c=>c.classList.remove("is-secret"));
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
  if(!joinedRoom){openAlert("Join a room first.");return;}
  if(!secret){openAlert("Pick a secret in Secret Mode.");return;}
  nonce = randHex(16);
  const commit = await sha256Hex(`${secret}:${nonce}`);
  ensureSocket();
  socket.emit("secret:commit",{room:joinedRoom,commit});
  committed=true; secretMode=false; secretModeBtn.textContent="Secret Mode: OFF"; lockSecretBtn.disabled=true;
  roomStatus.textContent="Secret locked. Wait for both guesses.";
}

function submitGuess(){
  const onCount = heroes.length - flipped.size;
  if(onCount!==1){openAlert("Keep only one hero visible to submit your guess.");return;}
  const id = onlyOn(); if(!id||!joinedRoom){openAlert("Join a room first.");return;}
  ensureSocket(); socket.emit("guess:submit",{room:joinedRoom,guess:id});
  roomStatus.textContent="Guess submitted. Waiting…";
}

function showResults(p){
  const youOk = p.you.correct;
  const oppName = nameFor(p.opponent.secret);
  const youName = nameFor(p.you.secret);
  const youGuessName = nameFor(p.you.guess);
  const oppGuessName = nameFor(p.opponent.guess);

  modalTitle.textContent = youOk ? "Victory" : "Defeat";
  modalTitle.style.color = youOk ? "var(--good)" : "var(--bad)";

  youCard.innerHTML = `<div class="pic"><img src="${imgFor(p.you.secret)}"/></div><div class="name">${youName}</div>`;
  oppCard.innerHTML = `<div class="pic"><img src="${imgFor(p.opponent.secret)}"/></div><div class="name">${oppName}</div>`;
  youGuess.textContent = `Your guess: ${youGuessName}`;
  oppGuess.textContent = `Opponent guess: ${oppGuessName}`;

  resultModal.classList.remove("hidden");
}

function nameFor(id){const h=heroes.find(x=>x.id===id); return h?h.name:id;}
function imgFor(id){const h=heroes.find(x=>x.id===id); return h?(h.img||("icons/"+h.slug+".png")):"";}

function closeModal(){resultModal.classList.add("hidden");}

fetch("/heroes.json").then(r=>r.json()).then(json=>{heroes=json; render();});

clearBtn.onclick=clearFlips;
toggleAllBtn.onclick=()=>setAll(!allHidden);
secretModeBtn.onclick=()=>{ if(committed){openAlert("Secret is locked.");return;} secretMode=!secretMode; secretModeBtn.textContent=secretMode?"Secret Mode: ON":"Secret Mode: OFF"; };
lockSecretBtn.onclick=lockSecret;
submitBtn.onclick=submitGuess;

joinBtn.onclick=join;
createBtn.onclick=create;
copyLinkBtn.onclick=copyInvite;

chatSend.onclick=sendChat;
chatText.addEventListener("keydown",e=>{if(e.key==="Enter") sendChat();});

playAgainBtn.onclick=()=>{closeModal(); clearFlips();};
closeModalBtn.onclick=closeModal;
alertOkBtn.onclick=closeAlert;

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom){roomInput.value=urlRoom.toUpperCase(); join();}
