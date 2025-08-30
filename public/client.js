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
const roomStatus=document.getElementById("roomStatus");
const chatLog=document.getElementById("chatLog");
const chatText=document.getElementById("chatText");
const chatSend=document.getElementById("chatSend");
const chatUser=document.getElementById("chatUser");
let heroes=[]; let flipped=new Set(); let joinedRoom=""; let socket=null; let secret=null;
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");}
function cardHTML(h){return `<div class="card" data-id="${h.id}"><div class="thumb">`+
`<img src="${h.img||("icons/"+h.slug+".png")}" alt="${h.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/>`+
`<div class="fallback" style="display:none">${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div></div>`+
`<div class="meta">${h.name}</div></div>`}
function render(){board.innerHTML=heroes.map(cardHTML).join(""); board.querySelectorAll(".card").forEach(c=>{const id=c.dataset.id; if(flipped.has(id)) c.classList.add("off"); c.onclick=()=>toggle(id); c.ondblclick=()=>setSecret(id);}); drawSecret();}
function toggle(id,remote){if(flipped.has(id)){flipped.delete(id); if(joinedRoom&&!remote) socket.emit("flip",{room:joinedRoom,id,off:false});}
else{flipped.add(id); if(joinedRoom&&!remote) socket.emit("flip",{room:joinedRoom,id,off:true});}
const el=board.querySelector(`.card[data-id="${id}"]`); if(el){if(flipped.has(id)) el.classList.add("off"); else el.classList.remove("off");}}
function all(off){const ids=heroes.map(h=>h.id); flipped = new Set(off?ids:[]); board.querySelectorAll(".card").forEach(c=> c.classList.toggle("off",off)); if(joinedRoom) socket.emit("bulk",{room:joinedRoom,ids,off});}
function reset(){flipped.clear(); board.querySelectorAll(".card").forEach(c=> c.classList.remove("off")); if(joinedRoom) socket.emit("reset",{room:joinedRoom});}
function setSecret(id){secret=id; drawSecret();}
function drawSecret(){if(!secret){secretSlot.innerHTML="None"; return;} const h=heroes.find(x=>x.id===secret); if(!h){secretSlot.innerHTML="None"; return;} secretSlot.innerHTML=`<div class="card" style="width:120px"><div class="thumb"><img src="${h.img||("icons/"+h.slug+".png")}" /><div class='fallback' style='display:none'>${h.name.split(" ").map(x=>x[0]).slice(0,2).join("")}</div></div><div class='meta'>${h.name}</div></div>`}
function exportState(){const off=[...flipped]; const on=heroes.map(h=>h.id).filter(x=>!flipped.has(x)); const data={off,on}; const t=navigator.clipboard?navigator.clipboard.writeText(JSON.stringify(data,null,2)):null; alert("State copied");}
function join(){const r=roomInput.value.trim(); if(!r) return; if(!socket) socket=io(); joinedRoom=r; socket.emit("join",r); roomStatus.textContent=`Joined ${r}`; socket.on("state",arr=>{flipped=new Set(arr); render();}); socket.on("flip",({id,off})=>{if(off) flipped.add(id); else flipped.delete(id); toggle(id,true);}); socket.on("bulk",({ids,off})=>{ids.forEach(x=> off?flipped.add(x):flipped.delete(x)); render();}); socket.on("reset",()=>{flipped.clear(); render();}); socket.on("chat",m=>addMsg(m));}
function addMsg(m){const d=new Date(m.ts||Date.now()); const e=document.createElement("div"); e.className="msg"; e.innerHTML=`<span class='u'>${m.user||"Player"}</span><span class='t'>${m.text}</span><span class='time' style='float:right;color:#79cda7;font-size:10px'>${d.toLocaleTimeString()}</span>`; chatLog.appendChild(e); chatLog.scrollTop=chatLog.scrollHeight;}
function sendChat(){const text=chatText.value.trim(); if(!text) return; const user=chatUser.value.trim()||"Player"; const m={room:joinedRoom,user,text}; addMsg({...m,ts:Date.now()}); chatText.value=""; if(joinedRoom&&socket) socket.emit("chat",m);}
fetch("/heroes.json").then(r=>r.json()).then(json=>{heroes=json; render();});
resetBtn.onclick=reset; allOnBtn.onclick=()=>all(false); allOffBtn.onclick=()=>all(true); exportBtn.onclick=exportState; randomSecretBtn.onclick=()=>{if(!heroes.length) return; const pool=heroes.filter(h=>!flipped.has(h.id)); const pick=pool[Math.floor(Math.random()*pool.length)]||heroes[0]; secret=pick.id; drawSecret();}; clearSecretBtn.onclick=()=>{secret=null; drawSecret();}; joinBtn.onclick=join; chatSend.onclick=sendChat; chatText.addEventListener("keydown",e=>{if(e.key==="Enter") sendChat();});
