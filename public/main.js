import { HandLandmarker, FilesetResolver }
    from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";


let SWAP_HANDS = false;
const FPS_TARGET = 24;
const MS_PER_FRAME = 1000 / FPS_TARGET;

const PAL = [
    {n:"Cyan",v:"#00f5ff"},{n:"Purple",v:"#bf00ff"},{n:"Green",v:"#00ff88"},
    {n:"Orange",v:"#ff6b00"},{n:"Pink",v:"#ff006e"},{n:"Yellow",v:"#ffdd00"},
    {n:"Red",v:"#ff2222"},{n:"White",v:"#ffffff"}
]

const BRUSHES = [{l:"fine", w:2}, {l:"Medium", w:5}, {l:"Thick", w:10}, {l: "XL", w:18}];

const SMOOTH_N = 5
const SMOOTH_THRESH = 0.55;
const PINCH_CONFIRM = 3;
const PINCH_D = 0.075;

const S = {
    ready: false,
    ci: 0,
    bi: 1,
    strokes: [],
    cur: null,
    eraseStrokes: [],
    erCur: null,
    eraseActive: false,
    floats: [],
    analyzing: false,
    L: makeHand(),
    R: makeHand(),
    leftState: 'idle',
    peaceOrigin: {x:0, y:0},
    peaceHov: null,
    drawActive: false,
    gestCD: 0,
    lastFrameTime: 0
}

function makeHand(){
    return{present:false, lms:null, ip:null, buf:[], pinchFrames:0, pinching:false, wasPinch:false};
}

function nullG(){
    return{pinch:false, pinky:false, peace:false, three:false, fist:false, thumb:false};
}

const cv = document.getElementById("canvas");
const cx = cv.getContext("2d");
const loadScreen = document.getElementById("loadScreen");
const loadMsg = document.getElementById("loadMsg");
const dotL = document.getElementById("dotL"), dotR = document.getElementById("dotR");
const stxtL = document.getElementById("stxtL"), stxtR = document.getElementById("stxtR");
const ssubL = document.getElementById("ssubL"), ssubR = document.getElementById("ssubR");
const cswL = document.getElementById("cswL"), cnameL = document.getElementById("cnameL");
const brushLbl = document.getElementById("brushLbl");
const cmdBar = document.getElementById("cmdBar");
const cmdText = document.getElementById("cmdText");
const cmdEmoji = document.getElementById("cmdEmoji");
const cmdMouseBtn = document.getElementById("cmdMouseBtn");
const aiPanel = document.getElementById("aiPanel");
const aiOCR = document.getElementById("aiOCR");
const aiComment = document.getElementById("aiComment");
const closeAI = document.getElementById("closeAI");
const hlist = document.getElementById("hlist");
const swapBtn = document.getElementById("swapBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const analyzeBtn = document.getElementById("analyzeBtn");

const drawLayer = document.createElement("canvas");
const dlCtx = drawLayer.getContext("2d");

function resize(){
    cv.width = cv.offsetWidth;
    cv.height = cv.offsetHeight;
    drawLayer.width = cv.width;
    drawLayer.height = cv.height;
}

new ResizeObserver(resize).observe(cv);
resize();

function detectRaw(lms, side){
    const up = (t,p) => lms[t].y < lms[p].y;
    const i = up(8,6), m = up(12,10), r = up(16,14), p = up(20,18);
    const thumbExt = side === 'R' ? lms[4].x > lms[3].x : lms[4].x < lms[3].x;
    const d = Math.hypot(lms[8].x-lms[4].x, lms[8].y-lms[4].y, lms[8].z-lms[4].z);
    return {
        pinch: d < PINCH_D,
        pinky: !i && !m && r && p && !thumbExt,   // ring+pinky = open color palette
        peace: i && m && !r && !p && !thumbExt,    // peace = clear canvas
        three: i && m && r && !p && !thumbExt,     // 3 fingers = undo
        fist:  !i && !m && !r && !p && !thumbExt,  // fist = brush
        thumb: thumbExt && !i && !m && !r && !p,   // thumb = AI
    };
}

function smooth(hand, raw) {
    hand.buf.push(raw);
    if(hand.buf.length > SMOOTH_N) hand.buf.shift();
    const n = hand.buf.length, out = {};
    for(const k of Object.keys(raw)) {
        out[k] = hand.buf.filter(g => g[k]).length >= Math.ceil(n*SMOOTH_THRESH);
    }
    return out;
}

const lm2c = lm => ({x:(1-lm.x)*cv.width, y:lm.y*cv.height});

function assignSide(lms){
    const side = lms[0].x < 0.5 ? 'R' : 'L';
    return SWAP_HANDS ? (side === 'L' ? 'R' : 'L') : side;
}

function setColor(i){
    S.ci = i;
    cswL.style.background = PAL[i].v;
    cswL.style.boxShadow = `0 0 8px ${PAL[i].v}55`;
    cnameL.textContent = PAL[i].n;
}

function cycleBrush(){ S.bi=(S.bi+1)%BRUSHES.length; brushLbl.textContent=BRUSHES[S.bi].l; }

function startStroke(p){ S.cur={c:PAL[S.ci].v, w:BRUSHES[S.bi].w, pts:[{...p}]}; }
function addPt(p){ if(S.cur) S.cur.pts.push({...p}); }
function endStroke(){ if(S.cur&&S.cur.pts.length>1) S.strokes.push(S.cur); S.cur=null; }
function undoLast(){ if(S.strokes.length) S.strokes.pop(); S.cur=null; }

function startErase(p){ S.erCur={w:BRUSHES[S.bi].w, pts:[{...p}]}; }
function addErasePt(p){ if(S.erCur) S.erCur.pts.push({...p}); }
function endErase(){ if(S.erCur&&S.erCur.pts.length>1) S.eraseStrokes.push(S.erCur); S.erCur=null; }

const WHEEL_R = 90;
function wheelPt(i){
    const a = (i/PAL.length)*Math.PI*2-Math.PI/2;
    return {x:S.peaceOrigin.x+Math.cos(a)*WHEEL_R, y:S.peaceOrigin.y+Math.sin(a)*WHEEL_R};
}

function updatePeaceHover(rip) {
    for(let i = 0; i < PAL.length; i++){
        if(Math.hypot(rip.x-wheelPt(i).x, rip.y-wheelPt(i).y)<28){ S.peaceHov=i; return; }
    }
    S.peaceHov = null;
}

const CMD_INFO = {
    cmd_peace:{e:"",t:"Point a color · Right Pinch or click to confirm"},
    cmd_fist: {e:"",t:"Right Pinch or click → change brush"},
    cmd_three:{e:"",t:"Right Pinch or click → undo"},
    cmd_palm: {e:"",t:"Right Pinch or click → clear all"},
    cmd_thumb:{e:"",t:"Right Pinch or click → analyze with AI"},
    draw:     {e:"",t:"Drawing — drop the left pinch to pause"},
    erase:    {e:"",t:"Erasing — drop the right pinch to stop"},
};
function showCmd(state){
    const info = CMD_INFO[state];
    if(info){ cmdEmoji.textContent = info.e; cmdText.textContent = info.t; cmdBar.classList.add("show"); }
    else{ cmdBar.classList.remove("show"); }
}

function executeCmd(){
    // Tutorial flags
    if(T.active){
        if(S.leftState==='cmd_three') T.flags.didUndo=true;
        if(S.leftState==='cmd_palm')  T.flags.didClear=true;
        if(S.leftState==='cmd_fist')  T.flags.didBrush=true;
        if(S.leftState==='cmd_thumb') T.flags.didAnalyze=true;
        if(S.leftState==='cmd_peace') T.flags.didColorChange=(S.peaceHov!==null && S.peaceHov!==T.prevCi);
    }
    switch(S.leftState){
        case 'cmd_peace': if(S.peaceHov!==null) setColor(S.peaceHov); break;
        case 'cmd_fist':  cycleBrush(); break;
        case 'cmd_three': undoLast();   break;
        case 'cmd_palm':  S.strokes=[]; S.cur=null; S.eraseStrokes=[]; S.erCur=null; S.floats=[]; break;
        case 'cmd_thumb': analyze();    break;
    }
    S.leftState = 'idle'; S.peaceHov = null;
    cmdBar.classList.remove("show");
}

function updateFSM(now){
    const Lh = S.L, Rh = S.R;
    const Lg = Lh.present ? smooth(Lh, detectRaw(Lh.lms,'L')) : nullG();
    const Rg = Rh.present ? smooth(Rh, detectRaw(Rh.lms, 'R')) : nullG();

    if(Rh.present) {
        Rh.wasPinch = Rh.pinching;
        Rh.pinchFrames = Rg.pinch ? Math.min(Rh.pinchFrames+1, PINCH_CONFIRM+2) : 0;
        Rh.pinching = Rh.pinchFrames >= PINCH_CONFIRM;
    } else { Rh.pinchFrames=0; Rh.pinching=false; Rh.wasPinch=false; }

    if(Lh.present){
        Lh.wasPinch = Lh.pinching;
        Lh.pinchFrames = Lg.pinch ? Math.min(Lh.pinchFrames+1, PINCH_CONFIRM+2) : 0;
        Lh.pinching = Lh.pinchFrames >= PINCH_CONFIRM;
    } else { Lh.pinchFrames=0; Lh.pinching=false; Lh.wasPinch=false; }

    
    if(Rh.pinching && !Rh.wasPinch && S.leftState!=='idle' && S.leftState!=='draw'){
        executeCmd(); return;
    }

    const CD = 450;

    // Modo borrar pero con un lapiz
    if(S.leftState === 'idle'){
        if(Rh.pinching){
            if(Lh.present){
                if(!S.eraseActive){ startErase(Lh.ip); S.eraseActive=true; }
                else addErasePt(Lh.ip);
            } else if(S.eraseActive){
                endErase(); S.eraseActive=false;
            }
        } else if(S.eraseActive){
            endErase(); S.eraseActive=false;
        }
    } else if(S.eraseActive){
        endErase(); S.eraseActive=false;
    }

    //  Modo borrar
    if(S.leftState === 'idle' && !S.eraseActive){
        if(!Lh.present){ showCmd(S.leftState); return; }
        if(Lh.pinching)                           S.leftState='draw';
        else if(Lg.pinky)                         { S.leftState='cmd_peace'; S.peaceOrigin=lm2c(Lh.lms[9]); S.peaceHov=null; }
        else if(Lg.peace  && now-S.gestCD>CD)     { S.leftState='cmd_palm';  S.gestCD=now; }
        else if(Lg.fist   && now-S.gestCD>CD)     { S.leftState='cmd_fist';  S.gestCD=now; }
        else if(Lg.three  && now-S.gestCD>CD)     { S.leftState='cmd_three'; S.gestCD=now; }
        else if(Lg.thumb  && now-S.gestCD>CD)     { S.leftState='cmd_thumb'; S.gestCD=now; }
    }

    // Modo dibujo
    if(S.leftState === 'draw'){
        if(!Lh.present || !Lh.pinching){ endStroke(); S.leftState='idle'; S.drawActive=false; return; }
        if(Rh.present){
            if(!S.drawActive){ startStroke(Rh.ip); S.drawActive=true; }
            else addPt(Rh.ip);
        } else if(S.drawActive){ endStroke(); S.drawActive=false; }
        return;
    }

    if(Lh.present){
        if(S.leftState==='cmd_fist'  && !Lg.fist)   S.leftState='idle';
        if(S.leftState==='cmd_three' && !Lg.three)  S.leftState='idle';
        if(S.leftState==='cmd_palm'  && !Lg.peace)  S.leftState='idle';
        if(S.leftState==='cmd_thumb' && !Lg.thumb)  S.leftState='idle';
    } else if(S.leftState!=='idle' && S.leftState!=='cmd_peace'){
        endStroke(); S.leftState='idle'; S.drawActive=false;
    }

    if(S.leftState === 'cmd_peace' && Rh.present) updatePeaceHover(Rh.ip);
    showCmd(S.eraseActive ? 'erase' : S.leftState);
    tutCheck();
}

function renderStroke(s, tc){
    const{c,w,pts} = s; if(pts.length<2) return;
    tc.save();
    tc.strokeStyle = c || "#fff";
    tc.lineWidth = w;
    tc.lineCap = "round";
    tc.lineJoin = "round";
    tc.shadowColor = c || "#fff";
    tc.shadowBlur = w*2;
    tc.beginPath();
    tc.moveTo(pts[0].x, pts[0].y);
    for(let i = 1; i < pts.length-1; i++){
        const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2;
        tc.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    tc.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    tc.stroke();
    tc.restore();
}

function rrect(c,x,y,w,h,r){
    c.beginPath();
    c.moveTo(x+r,y);
    c.lineTo(x+w-r,y);
    c.arcTo(x+w,y,x+w,y+r,r);
    c.lineTo(x+w,y+h-r);
    c.arcTo(x+w,y+h,x+w-r,y+h,r);
    c.lineTo(x+r, y+h);
    c.arcTo(x,y+h,x,y+h-r,r);
    c.lineTo(x,y+r);
    c.arcTo(x,y,x+r,y,r);
    c.closePath();
}

const vid = document.createElement("video");
vid.autoplay = true;
vid.playsInline = true;
vid.muted = true;

function drawFrame(now){
    const W=cv.width, H=cv.height;
    cx.save(); cx.translate(W,0); cx.scale(-1,1); cx.drawImage(vid,0,0,W,H); cx.restore();
    cx.fillStyle="rgba(5,5,16,.38)";
    cx.fillRect(0,0,W,H);

    dlCtx.clearRect(0,0,W,H);
    for(const s of S.strokes) renderStroke(s, dlCtx);
    if(S.cur) renderStroke(S.cur, dlCtx);
    dlCtx.globalCompositeOperation = 'destination-out';
    for(const s of S.eraseStrokes) renderStroke(s, dlCtx);
    if(S.erCur) renderStroke(S.erCur, dlCtx);
    dlCtx.globalCompositeOperation = 'source-over';
    cx.drawImage(drawLayer, 0, 0);

    drawWheelIfNeeded();
    drawCursors();
    drawHandLabels();
    drawFloats(now);
}

function drawWheelIfNeeded(){
    if(S.leftState !== 'cmd_peace') return;
    const{x:ox, y:oy}=S.peaceOrigin, n=PAL.length;
    cx.save(); cx.beginPath(); cx.arc(ox,oy,WHEEL_R+44,0,Math.PI*2);
    cx.fillStyle="rgba(0,0,0,.62)"; cx.fill(); cx.restore();
    for(let i=0; i<n; i++){
        const p = wheelPt(i), hov=i===S.peaceHov, rad=hov?24:16;
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
        if(S.eraseActive && S.L.ip){
            // Eraser cursor on left index tip
            const pos = S.L.ip, bw = BRUSHES[S.bi].w;
            cx.save();
            cx.beginPath(); cx.arc(pos.x, pos.y, bw/2+6, 0, Math.PI*2);
            cx.strokeStyle="rgba(255,255,255,.85)"; cx.lineWidth=2;
            cx.setLineDash([4,4]); cx.stroke(); cx.setLineDash([]);
            cx.beginPath(); cx.arc(pos.x,pos.y,3,0,Math.PI*2);
            cx.fillStyle="rgba(255,255,255,.6)"; cx.fill();
            cx.restore();
        } else {
            const w = lm2c(S.L.lms[0]);
            const c = S.leftState==='draw'?"#00ff88":S.leftState!=='idle'?"#00f5ff":"rgba(0,245,255,.2)";
            cx.save(); cx.beginPath(); cx.arc(w.x,w.y,13,0,Math.PI*2);
            cx.strokeStyle=c; cx.lineWidth=1.5; cx.setLineDash([4,4]); cx.stroke(); cx.setLineDash([]); cx.restore();
        }
    }
    if(S.R.present && S.R.ip){
        const pos = S.R.ip, c = PAL[S.ci].v, bw = BRUSHES[S.bi].w;
        cx.save();
        if(S.R.pinching){
            cx.shadowColor = c; cx.shadowBlur = 20;
            cx.beginPath();
            cx.arc(pos.x,pos.y,bw/2+5,0,Math.PI*2);
            cx.fillStyle = c;
            cx.fill();
        } else {
            const r = Math.max(12, bw/2+6);
            cx.beginPath(); cx.arc(pos.x,pos.y,r,0,Math.PI*2);
            cx.strokeStyle = c; cx.lineWidth = 1.5;
            cx.setLineDash([5,5]); cx.stroke(); cx.setLineDash([]);
            cx.beginPath(); cx.arc(pos.x,pos.y,3,0,Math.PI*2);
            cx.fillStyle = c; cx.fill();
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

function drawFloats(now){
    S.floats = S.floats.filter(f=>now-f.t<f.life);
    for(const f of S.floats){
        const age=now-f.t, op=age<300?age/300:age>f.life-500?(f.life-age)/500:1;
        cx.save();
        cx.globalAlpha=op;
        cx.font="bold 19px 'Space Grotesk',sans-serif";
        cx.textAlign="center";
        const fw=cx.measureText(f.text).width+26, fh=36;
        rrect(cx,f.x-fw/2,f.y-fh/2,fw,fh,11);
        cx.fillStyle="rgba(0,0,0,.72)"; cx.fill();
        cx.strokeStyle="rgba(191,0,255,.5)";
        cx.lineWidth=1.5; cx.stroke();
        cx.fillStyle="#bf00ff"; cx.shadowColor="#bf00ff"; cx.shadowBlur=12;
        cx.fillText(f.text,f.x,f.y+6);
        cx.restore();
    }
}

const STATE_TEXT = {
    idle:'Waiting for a gesture', draw:'Drawing Mode', cmd_peace:'Choose a color — locked until selected',
    cmd_fist:'Ready — confirm', cmd_three:'Ready — confirm',
    cmd_palm:'Ready — confirm', cmd_thumb:'Ready — confirm',
};

function updateUI(){
    if(S.L.present){ dotL.classList.add("on"); stxtL.textContent="Detected"; ssubL.textContent=STATE_TEXT[S.leftState]||""; }
    else{ dotL.classList.remove("on"); stxtL.textContent="Not detected"; ssubL.textContent="Show your left hand"; }
    if(S.R.present){
        dotR.classList.add("on");
        stxtR.textContent = S.eraseActive ? "Erasing" : S.R.pinching ? "Pinch" : "Detected";
        ssubR.textContent = S.eraseActive ? "Left index to erase" : S.leftState==='draw' ? "Draw with your index" : "Pinch to confirm";
    } else{ dotR.classList.remove("on"); stxtR.textContent="Not detected"; ssubR.textContent="Show your right hand"; }
}

function addHistory(text){
    const el=document.createElement("div");
    el.className="hitem";
    el.innerHTML=`<div class="htext">${text||"(no text)"}</div><div class="htime">${new Date().toLocaleTimeString()}</div>`;
    if(hlist.querySelector(".hempty")) hlist.innerHTML="";
    hlist.insertBefore(el,hlist.firstChild);
}

async function analyze(){
    if(S.analyzing||S.strokes.length===0) return;
    S.analyzing=true;
    aiPanel.classList.remove("hidden");
    aiOCR.style.display="none";
    aiComment.innerHTML=`<div class="lrow"><div class="mspin"></div>Analyzing…</div>`;
    try{
        const off=document.createElement("canvas");
        off.width=cv.width; off.height=cv.height;
        const oc=off.getContext("2d");
        oc.fillStyle="#000"; oc.fillRect(0,0,off.width,off.height);
        for(const s of S.strokes) renderStroke(s,oc);
        oc.globalCompositeOperation = 'destination-out';
        for(const s of S.eraseStrokes) renderStroke(s,oc);
        oc.globalCompositeOperation = 'source-over';
        const b64=off.toDataURL("image/png").split(",")[1];
        const res=await fetch("/api/analyze",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({image:b64})
        });
        if(!res.ok){ const e=await res.json(); throw new Error(e.error||res.statusText); }
        const data=await res.json();
        const p = data;
        if(p.provider) document.getElementById("aiTitle").textContent=` ${p.provider} thinks`;
        if(p.texto){
            aiOCR.style.display="block";
            aiOCR.textContent=`"${p.texto}"`;
            S.floats.push({text:p.texto,x:cv.width*.5,y:cv.height*.18,t:performance.now(),life:5500});
        }
        aiComment.innerHTML=`<div style="color:rgba(255,255,255,.32);font-size:.68rem;margin-bottom:3px">${p.descripcion||""}</div><div>${p.comentario||""}</div>`;
        addHistory(p.texto||p.descripcion);
    } catch(e){
        aiComment.innerHTML=`<span style="color:#f66;font-size:.76rem">Error: ${e.message}</span>`;
    }
    S.analyzing=false;
}


// Tutorial 
const TUTORIAL_STEPS = [
    {
        emoji:"", title:"Draw a line",
        desc:"Hold a <b>left pinch</b> (index+thumb on left hand), then trace with your <b>right index finger</b>. Draw any line to continue.",
        check: (S,g) => S.strokes.length >= 1
    },
    {
        emoji:"", title:"Erase something",
        desc:"Hold a <b>right pinch</b> and move your <b>left index finger</b> over any stroke to erase it.",
        check: (S,g) => S.eraseStrokes.length >= 1
    },
    {
        emoji:"", title:"Undo a stroke",
        desc:"Show <b>3 fingers</b> on your left hand (index, middle, ring), then <b>right pinch</b> to confirm.",
        check: (S,g) => g.didUndo
    },
    {
        emoji:"", title:"Open the color palette",
        desc:"Extend your <b>ring + pinky fingers</b> on your left hand. The color wheel will appear.",
        check: (S,g) => S.leftState === 'cmd_peace'
    },
    {
        emoji:"", title:"Pick a color",
        desc:"While the color wheel is open, <b>hover over a color</b> with your right index and <b>right pinch</b> to confirm.",
        check: (S,g) => g.didColorChange
    },
    {
        emoji:"", title:"Clear the canvas",
        desc:"Make a <b>peace sign</b> (index+middle) with your left hand, then <b>right pinch</b> to confirm.",
        check: (S,g) => g.didClear
    },
    {
        emoji:"", title:"Change brush size",
        desc:"Make a <b>fist</b> with your left hand, then <b>right pinch</b> to cycle through brush sizes.",
        check: (S,g) => g.didBrush
    },
    {
        emoji:"", title:"Analyze with AI",
        desc:"<b>Draw something</b> first, then extend your <b>left thumb</b> and <b>right pinch</b> to send it to AI.",
        check: (S,g) => g.didAnalyze
    },
];

const T = {
    active: false, step: 0,
    flags: { didUndo:false, didColorChange:false, didClear:false, didBrush:false, didAnalyze:false },
    prevCi: 0,
};

const tutorialScreen = document.getElementById("tutorialScreen");
const tutStepEl  = document.getElementById("tutStep");
const tutEmoji   = document.getElementById("tutEmoji");
const tutTitle   = document.getElementById("tutTitle");
const tutDesc    = document.getElementById("tutDesc");
const tutBar     = document.getElementById("tutBar");
const tutDetect  = document.getElementById("tutDetect");
const tutSkipBtn = document.getElementById("tutSkipBtn");

function tutRender(){
    if(T.step >= TUTORIAL_STEPS.length){ tutEnd(); return; }
    const s = TUTORIAL_STEPS[T.step];
    tutStepEl.textContent = `Step ${T.step+1} of ${TUTORIAL_STEPS.length}`;
    tutEmoji.textContent  = s.emoji;
    tutTitle.textContent  = s.title;
    tutDesc.innerHTML     = s.desc;
    tutBar.style.width    = `${(T.step/TUTORIAL_STEPS.length)*100}%`;
    tutDetect.textContent = "Waiting for gesture…";
}

function tutAdvance(){
    tutDetect.textContent = "✓ Done!";
    tutBar.style.width = `${((T.step+1)/TUTORIAL_STEPS.length)*100}%`;
    setTimeout(()=>{
        T.step++;
        Object.keys(T.flags).forEach(k => T.flags[k]=false);
        T.prevCi = S.ci;
        tutRender();
    }, 800);
}

function tutEnd(){
    T.active = false;
    tutorialScreen.classList.add("hidden");
}

function tutCheck(){
    if(!T.active || T.step >= TUTORIAL_STEPS.length) return;
    if(TUTORIAL_STEPS[T.step].check(S, T.flags)) tutAdvance();
}

function tutStart(){
    T.active = true;
    T.step = 0;
    T.prevCi = S.ci;
    Object.keys(T.flags).forEach(k => T.flags[k]=false);
    tutorialScreen.classList.remove("hidden");
    tutRender();
}

tutSkipBtn.addEventListener("click", tutEnd);

let hl, lastVT = -1;

function loop(now){
    requestAnimationFrame(loop);
    if(!S.ready) return;
    if(now - S.lastFrameTime < MS_PER_FRAME) return;
    S.lastFrameTime = now;
    if(vid.readyState >= 2){
        if(vid.currentTime !== lastVT){
            lastVT = vid.currentTime;
            const result = hl.detectForVideo(vid,now);
            S.L.present = false; S.R.present = false;
            S.L.lms = null; S.R.lms = null;
            if(result.landmarks?.length){
                for(let i = 0; i < result.landmarks.length; i++){
                    const lms = result.landmarks[i];
                    const side = assignSide(lms);
                    const hand = S[side];
                    if(hand.present) continue;
                    hand.present = true;
                    hand.lms = lms;
                    hand.ip = lm2c(lms[8]);
                }
            }
            if(!S.L.present){ S.L.buf=[]; S.L.pinchFrames=0; S.L.pinching=false; }
            if(!S.R.present){ S.R.buf=[]; S.R.pinchFrames=0; S.R.pinching=false; }
            if(T.active) tutCheck();
            updateFSM(now);
            updateUI();
        }
    }
    drawFrame(now);
}


function showTutorialIntro(){
    const intro = document.getElementById("tutorialIntro");
    if(intro) intro.classList.remove("hidden");
}
async function startApp() {
    loadScreen.classList.remove("hidden");
    try {
        loadMsg.textContent="Loading MediaPipe model…";
        const fs=await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        hl=await HandLandmarker.createFromOptions(fs,{
            baseOptions:{
                modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate:"CPU"
            },
            runningMode:"VIDEO",
            numHands:2,
            minHandDetectionConfidence:0.45,
            minHandPresenceConfidence:0.45,
            minTrackingConfidence:0.4
        });
        loadMsg.textContent="Accessing the camera…";
        const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"}});
        vid.srcObject=stream;
        await new Promise(r=>{vid.onloadedmetadata=()=>{vid.play();r();};});
        setColor(0);
        loadMsg.textContent="Ready!";
        await new Promise(r=>setTimeout(r,600));
        loadScreen.classList.add("hidden");
        S.ready=true;
        requestAnimationFrame(loop);
        showTutorialIntro();
    } catch(e){
        loadMsg.textContent="Error: "+e.message;
        console.error(e);
    }
}

cmdMouseBtn.addEventListener("click",()=>{
    if(S.leftState!=='idle'&&S.leftState!=='draw') executeCmd();
});
closeAI.addEventListener("click",()=>aiPanel.classList.add("hidden"));
swapBtn.addEventListener("click",()=>{
    SWAP_HANDS=!SWAP_HANDS;
    swapBtn.classList.toggle("active",SWAP_HANDS);
    swapBtn.textContent=SWAP_HANDS?"Switch Hands (active)":"Switch hands";
    S.L.buf=[]; S.R.buf=[]; S.leftState='idle';
});
undoBtn.addEventListener("click",()=>undoLast());
clearBtn.addEventListener("click",()=>{ S.strokes=[]; S.cur=null; S.eraseStrokes=[]; S.erCur=null; S.floats=[]; });
analyzeBtn.addEventListener("click",()=>analyze());
document.getElementById("tutStartBtn").addEventListener("click",()=>{
    document.getElementById("tutorialIntro").classList.add("hidden");
    tutStart();
});
document.getElementById("tutSkipIntroBtn").addEventListener("click",()=>{
    document.getElementById("tutorialIntro").classList.add("hidden");
});
startApp();