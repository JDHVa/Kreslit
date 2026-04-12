import { HandLandmarker, FilesetResolver }
    from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

import { createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";


const SUPABASE_URL  = window.SUPABASE_URL  || "";
const SUPABASE_ANON = window.SUPABASE_ANON_KEY || "";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

let SWAP_HANDS = false;
const FPS_TARGET = 24;
const MS_PER_FRAME = 1000 / FPS_TARGET;

const PAL = [
    {n:"Cyan",   v:"#00f5ff"},{n:"Purple",v:"#bf00ff"},{n:"Green", v:"#00ff88"},
    {n:"Orange", v:"#ff6b00"},{n:"Pink",  v:"#ff006e"},{n:"Yellow",v:"#ffdd00"},
    {n:"Red",    v:"#ff2222"},{n:"White", v:"#ffffff"}
];
const BRUSH_W = 5;

const SMOOTH_N      = 5;
const SMOOTH_THRESH = 0.55;
const PINCH_CONFIRM = 3;
const PINCH_D       = 0.075;
const WHEEL_R       = 90;

const S = {
    ready: false,
    ci: 0,
    strokes: [],        
    cur: null,           
    L: makeHand(), R: makeHand(),
    leftState: 'idle',    
    peaceOrigin: {x:0,y:0},
    peaceHov: null,
    drawActive: false,
    lastFrameTime: 0,
    panelId: null,
    userName: "Guest",
    onlineUsers: {},      
    myUserId: crypto.randomUUID().slice(0,8),
};

function makeHand(){
    return {present:false, lms:null, ip:null, buf:[], pinchFrames:0, pinching:false, wasPinch:false};
}
function nullG(){
    return {pinch:false, pinky:false};
}

const cv        = document.getElementById("canvas");
const cx        = cv.getContext("2d");
const loadScreen= document.getElementById("loadScreen");
const loadMsg   = document.getElementById("loadMsg");
const dotL      = document.getElementById("dotL"),  dotR      = document.getElementById("dotR");
const stxtL     = document.getElementById("stxtL"), stxtR     = document.getElementById("stxtR");
const ssubL     = document.getElementById("ssubL"), ssubR     = document.getElementById("ssubR");
const cswL      = document.getElementById("cswL"),  cnameL    = document.getElementById("cnameL");
const onlineLbl = document.getElementById("onlineLbl");
const usersList = document.getElementById("usersList");
const panelNameLbl  = document.getElementById("panelNameLbl");
const panelOwnerLbl = document.getElementById("panelOwnerLbl");
const swapBtn   = document.getElementById("swapBtn");
const backBtn   = document.getElementById("backBtn");

function resize(){ cv.width=cv.offsetWidth; cv.height=cv.offsetHeight; }
new ResizeObserver(resize).observe(cv); resize();

function detectRaw(lms, side){
    const up = (t,p) => lms[t].y < lms[p].y;
    const i = up(8,6), m = up(12,10), r = up(16,14), p = up(20,18);
    const thumbExt = side === 'R' ? lms[4].x > lms[3].x : lms[4].x < lms[3].x;
    const d = Math.hypot(lms[8].x-lms[4].x, lms[8].y-lms[4].y, lms[8].z-lms[4].z);
    return {
        pinch: d < PINCH_D,
        pinky: thumbExt && !i && !m && !r && p && true,
    };
}

function smooth(hand, raw){
    hand.buf.push(raw);
    if(hand.buf.length > SMOOTH_N) hand.buf.shift();
    const n = hand.buf.length, out = {};
    for(const k of Object.keys(raw)){
        out[k] = hand.buf.filter(g=>g[k]).length >= Math.ceil(n*SMOOTH_THRESH);
    }
    return out;
}

const lm2c = lm => ({x:(1-lm.x)*cv.width, y:lm.y*cv.height});

function assignSide(lms){
    const side = lms[0].x < 0.5 ? 'R' : 'L';
    return SWAP_HANDS ? (side==='L'?'R':'L') : side;
}

function setColor(i){
    S.ci = i;
    cswL.style.background = PAL[i].v;
    cswL.style.boxShadow  = `0 0 8px ${PAL[i].v}55`;
    cnameL.textContent    = PAL[i].n;
}

function startStroke(p){ S.cur={c:PAL[S.ci].v, w:BRUSH_W, pts:[{...p}], user:S.myUserId}; }
function addPt(p){ if(S.cur) S.cur.pts.push({...p}); }
async function endStroke(){
    if(!S.cur || S.cur.pts.length < 2){ S.cur=null; return; }
    const stroke = {...S.cur};
    S.strokes.push(stroke);
    S.cur = null;
    await sb.from("strokes").insert({
        panel_id: S.panelId,
        stroke_data: stroke
    });
}

function wheelPt(i){
    const a = (i/PAL.length)*Math.PI*2-Math.PI/2;
    return {x:S.peaceOrigin.x+Math.cos(a)*WHEEL_R, y:S.peaceOrigin.y+Math.sin(a)*WHEEL_R};
}
function updatePeaceHover(rip){
    for(let i=0;i<PAL.length;i++){
        if(Math.hypot(rip.x-wheelPt(i).x, rip.y-wheelPt(i).y)<28){ S.peaceHov=i; return; }
    }
    S.peaceHov=null;
}

function updateFSM(){
    const Lh=S.L, Rh=S.R;
    const Lg = Lh.present ? smooth(Lh, detectRaw(Lh.lms,'L')) : nullG();
    const Rg = Rh.present ? smooth(Rh, detectRaw(Rh.lms,'R')) : nullG();

    if(Rh.present){
        Rh.wasPinch=Rh.pinching;
        Rh.pinchFrames = Rg.pinch ? Math.min(Rh.pinchFrames+1,PINCH_CONFIRM+2) : 0;
        Rh.pinching = Rh.pinchFrames >= PINCH_CONFIRM;
    } else { Rh.pinchFrames=0; Rh.pinching=false; Rh.wasPinch=false; }

    if(Lh.present){
        Lh.wasPinch=Lh.pinching;
        Lh.pinchFrames = Lg.pinch ? Math.min(Lh.pinchFrames+1,PINCH_CONFIRM+2) : 0;
        Lh.pinching = Lh.pinchFrames >= PINCH_CONFIRM;
    } else { Lh.pinchFrames=0; Lh.pinching=false; Lh.wasPinch=false; }

    if(Rh.pinching && !Rh.wasPinch && S.leftState==='cmd_peace'){
        if(S.peaceHov!==null) setColor(S.peaceHov);
        S.leftState='idle'; S.peaceHov=null;
        return;
    }

    if(S.leftState==='idle'){
        if(!Lh.present) return;
        if(Lh.pinching)  S.leftState='draw';
        else if(Lg.pinky){ S.leftState='cmd_peace'; S.peaceOrigin=lm2c(Lh.lms[9]); S.peaceHov=null; }
    }

    if(S.leftState==='draw'){
        if(!Lh.present||!Lh.pinching){ endStroke(); S.leftState='idle'; S.drawActive=false; return; }
        if(Rh.present){
            if(!S.drawActive){ startStroke(Rh.ip); S.drawActive=true; }
            else addPt(Rh.ip);
        } else if(S.drawActive){ endStroke(); S.drawActive=false; }
        return;
    }

    if(S.leftState==='cmd_peace'){
        if(!Lh.present){ S.leftState='idle'; S.peaceHov=null; return; }
        if(Rh.present) updatePeaceHover(Rh.ip);
    }
}

function renderStroke(s, tc){
    const{c,w,pts}=s; if(pts.length<2) return;
    tc.save(); tc.strokeStyle=c; tc.lineWidth=w; tc.lineCap="round"; tc.lineJoin="round";
    tc.shadowColor=c; tc.shadowBlur=w*2;
    tc.beginPath(); tc.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length-1;i++){
        const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2;
        tc.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
    }
    tc.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
    tc.stroke(); tc.restore();
}

function drawFrame(){
    const W=cv.width, H=cv.height;
    cx.save(); cx.translate(W,0); cx.scale(-1,1); cx.drawImage(vid,0,0,W,H); cx.restore();
    cx.fillStyle="rgba(5,5,16,.38)"; cx.fillRect(0,0,W,H);
    for(const s of S.strokes) renderStroke(s,cx);
    if(S.cur) renderStroke(S.cur,cx);
    drawWheelIfNeeded();
    drawCursors();
    drawHandLabels();
}

function drawWheelIfNeeded(){
    if(S.leftState!=='cmd_peace') return;
    const{x:ox,y:oy}=S.peaceOrigin, n=PAL.length;
    cx.save(); cx.beginPath(); cx.arc(ox,oy,WHEEL_R+44,0,Math.PI*2);
    cx.fillStyle="rgba(0,0,0,.62)"; cx.fill(); cx.restore();
    for(let i=0;i<n;i++){
        const p=wheelPt(i), hov=i===S.peaceHov, rad=hov?24:16;
        cx.save();
        if(hov){ cx.shadowColor=PAL[i].v; cx.shadowBlur=24; }
        cx.beginPath(); cx.arc(p.x,p.y,rad,0,Math.PI*2); cx.fillStyle=PAL[i].v; cx.fill();
        if(hov){
            cx.strokeStyle="#fff"; cx.lineWidth=2.5; cx.stroke();
            cx.font="bold 11px 'Space Grotesk',sans-serif"; cx.textAlign="center";
            cx.fillStyle="#fff"; cx.fillText(PAL[i].n,p.x,p.y+rad+13);
        }
        cx.restore();
    }
}

function drawCursors(){
    if(S.L.present && S.L.lms){
        const w=lm2c(S.L.lms[0]);
        const c=S.leftState==='draw'?"#00ff88":S.leftState!=='idle'?"#00f5ff":"rgba(0,245,255,.2)";
        cx.save(); cx.beginPath(); cx.arc(w.x,w.y,13,0,Math.PI*2);
        cx.strokeStyle=c; cx.lineWidth=1.5; cx.setLineDash([4,4]); cx.stroke(); cx.setLineDash([]); cx.restore();
    }
    if(S.R.present && S.R.ip){
        const pos=S.R.ip, c=PAL[S.ci].v;
        cx.save(); cx.shadowColor=c; cx.shadowBlur=S.R.pinching?20:0;
        if(S.R.pinching){
            cx.beginPath(); cx.arc(pos.x,pos.y,9,0,Math.PI*2); cx.fillStyle=c; cx.fill();
        } else {
            cx.beginPath(); cx.arc(pos.x,pos.y,12,0,Math.PI*2);
            cx.strokeStyle=c; cx.lineWidth=1.5; cx.setLineDash([5,5]); cx.stroke(); cx.setLineDash([]);
            cx.beginPath(); cx.arc(pos.x,pos.y,3,0,Math.PI*2); cx.fillStyle=c; cx.fill();
        }
        cx.restore();
    }
}

function drawHandLabels(){
    if(!S.L.present && !S.R.present) return;
    cx.font="bold 11px 'Space Grotesk',sans-serif"; cx.textAlign="center";
    if(S.L.present && S.L.lms){
        const w=lm2c(S.L.lms[0]);
        cx.fillStyle="rgba(0,245,255,.5)"; cx.fillText("LEFT",w.x,w.y-18);
    }
    if(S.R.present && S.R.lms){
        const w=lm2c(S.R.lms[0]);
        cx.fillStyle="rgba(191,0,255,.5)"; cx.fillText("RIGHT",w.x,w.y-18);
    }
}

function updateUI(){
    if(S.L.present){ dotL.classList.add("on"); stxtL.textContent="Detected";
        ssubL.textContent=S.leftState==='draw'?"Drawing…":S.leftState==='cmd_peace'?"Choose color":"Idle"; }
    else{ dotL.classList.remove("on"); stxtL.textContent="Not detected"; ssubL.textContent="Show your left hand"; }
    if(S.R.present){ dotR.classList.add("on"); stxtR.textContent=S.R.pinching?"🤌 Pinch":"Detected";
        ssubR.textContent=S.leftState==='draw'?"Draw with index":"Pinch to confirm"; }
    else{ dotR.classList.remove("on"); stxtR.textContent="Not detected"; ssubR.textContent="Show your right hand"; }
}

function updateOnlineUI(){
    const users = Object.values(S.onlineUsers);
    const count = users.length;
    onlineLbl.textContent = `${count} user${count!==1?'s':''} online`;
    usersList.innerHTML = users.map(u=>`
        <div class="user-badge" style="color:${u.color};border-color:${u.color}40;background:${u.color}10">
            ${u.name}
        </div>
    `).join("");
}

async function loadStrokes(){
    const { data } = await sb.from("strokes")
        .select("stroke_data")
        .eq("panel_id", S.panelId)
        .order("created_at", {ascending:true});
    if(data) S.strokes = data.map(r => r.stroke_data);
}

function subscribeRealtime(){
    sb.channel(`panel:${S.panelId}`)
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "strokes",
            filter: `panel_id=eq.${S.panelId}`
        }, payload => {
            const stroke = payload.new.stroke_data;
            if(stroke.user !== S.myUserId){
                S.strokes.push(stroke);
            }
            if(stroke.user && stroke.c){
                const existing = S.onlineUsers[stroke.user];
                S.onlineUsers[stroke.user] = {
                    name: existing?.name || `User ${stroke.user.slice(0,4)}`,
                    color: stroke.c,
                    lastSeen: Date.now()
                };
                updateOnlineUI();
            }
        })
        .subscribe();

    S.onlineUsers[S.myUserId] = {
        name: S.userName,
        color: PAL[S.ci].v,
        lastSeen: Date.now()
    };
    updateOnlineUI();

    setInterval(()=>{
        const now = Date.now();
        for(const id of Object.keys(S.onlineUsers)){
            if(id !== S.myUserId && now - S.onlineUsers[id].lastSeen > 30000){
                delete S.onlineUsers[id];
            }
        }
        updateOnlineUI();
    }, 10000);
}

const vid = document.createElement("video");
vid.autoplay=true; vid.playsInline=true; vid.muted=true;

let hl, lastVT=-1;

function loop(now){
    requestAnimationFrame(loop);
    if(!S.ready) return;
    if(now - S.lastFrameTime < MS_PER_FRAME) return;
    S.lastFrameTime = now;

    if(vid.readyState >= 2){
        if(vid.currentTime !== lastVT){
            lastVT = vid.currentTime;
            const result = hl.detectForVideo(vid, now);

            S.L.present=false; S.R.present=false;
            S.L.lms=null; S.R.lms=null;

            if(result.landmarks?.length){
                for(let i=0;i<result.landmarks.length;i++){
                    const lms=result.landmarks[i];
                    const side=assignSide(lms);
                    const hand=S[side];
                    if(hand.present) continue;
                    hand.present=true; hand.lms=lms; hand.ip=lm2c(lms[8]);
                }
            }

            if(!S.L.present){ S.L.buf=[]; S.L.pinchFrames=0; S.L.pinching=false; }
            if(!S.R.present){ S.R.buf=[]; S.R.pinchFrames=0; S.R.pinching=false; }

            updateFSM();
            updateUI();
        }
    }
    drawFrame();
}

async function init(){
    const params = new URLSearchParams(window.location.search);
    S.panelId = params.get("panel");
    if(!S.panelId){ window.location.href="index.html"; return; }

    S.userName = sessionStorage.getItem("collab_username") || "Guest";
    S.onlineUsers[S.myUserId] = { name: S.userName, color: PAL[S.ci].v, lastSeen: Date.now() };

    try {
        const { data: panel } = await sb.from("panels").select("*").eq("id", S.panelId).single();
        if(!panel){ window.location.href="index.html"; return; }
        panelNameLbl.textContent  = panel.name;
        panelOwnerLbl.textContent = `by ${panel.owner_name}`;

        loadMsg.textContent = "Loading MediaPipe…";
        const fs = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        hl = await HandLandmarker.createFromOptions(fs, {
            baseOptions:{
                modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate:"CPU"
            },
            runningMode:"VIDEO", numHands:2,
            minHandDetectionConfidence:0.45,
            minHandPresenceConfidence:0.45,
            minTrackingConfidence:0.4
        });

        loadMsg.textContent = "Loading strokes…";
        await loadStrokes();

        loadMsg.textContent = "Accessing camera…";
        const stream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"}});
        vid.srcObject = stream;
        await new Promise(r=>{ vid.onloadedmetadata=()=>{ vid.play(); r(); }; });

        subscribeRealtime();
        setColor(0);

        loadMsg.textContent = "Ready!";
        await new Promise(r=>setTimeout(r,500));
        loadScreen.classList.add("hidden");
        S.ready = true;
        requestAnimationFrame(loop);
    } catch(e){
        loadMsg.textContent = "Error: "+e.message;
        console.error(e);
    }
}

swapBtn.addEventListener("click",()=>{
    SWAP_HANDS=!SWAP_HANDS;
    swapBtn.classList.toggle("active", SWAP_HANDS);
    swapBtn.textContent = SWAP_HANDS ? "⇄ Swapped (active)" : "⇄ Swap hands";
    S.L.buf=[]; S.R.buf=[];
});
backBtn.addEventListener("click",()=>window.location.href="index.html");

init();