import { HandLandmarker, FilesetResolver }
    from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

let SWAP_HANDS = false;
const FPS_TARGET = 24;
const MS_PER_FRAME = 1000 / FPS_TARGET;
const SMOOTH_N = 5, SMOOTH_THRESH = 0.55;
const PINCH_CONFIRM = 3, PINCH_D = 0.075;
const WHEEL_R = 90;

const PAL = [
    {n:"Cyan",v:"#00f5ff"},{n:"Purple",v:"#bf00ff"},{n:"Green",v:"#00ff88"},
    {n:"Orange",v:"#ff6b00"},{n:"Pink",v:"#ff006e"},{n:"Yellow",v:"#ffdd00"},
    {n:"Red",v:"#ff2222"},{n:"White",v:"#ffffff"}
];

const GESTURES = {
    draw: {
        id:"draw", emoji:"", name:"Draw a line",
        desc:"Hold a <b>left pinch</b> and trace with your <b>right index finger</b>.",
        hands:[{label:"Left pinch",side:"L"},{label:"Right index",side:"R"}],
        hint:"Left pinch + move right index", next:"erase",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lh.pinching && Rh.present){
                state.drawFrames=(state.drawFrames||0)+1;
                return Math.min(state.drawFrames/30,1);
            }
            state.drawFrames=0; return 0;
        }
    },
    erase: {
        id:"erase", emoji:"", name:"Erase",
        desc:"Hold a <b>right pinch</b> and move your <b>left index finger</b> to erase the line.",
        hands:[{label:"Right pinch",side:"R"},{label:"Left index",side:"L"}],
        hint:"Right pinch + move left index", next:"undo",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Rh.present && Rh.pinching && Lh.present){
                state.eraseFrames=(state.eraseFrames||0)+1;
                return Math.min(state.eraseFrames/30,1);
            }
            state.eraseFrames=0; return 0;
        }
    },
    undo: {
        id:"undo", emoji:"↩️", name:"Undo",
        desc:"Show <b>3 fingers</b> (index, middle, ring) with your left hand, then <b>right pinch</b>.",
        hands:[{label:"3 fingers left",side:"L"},{label:"Right pinch",side:"R"}],
        hint:"Left 3 fingers → Right pinch", next:"color",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lg.three){
                state.threeReady=true;
                state.threeFrames=(state.threeFrames||0)+1;
                if(!state.confirmed) return Math.min(state.threeFrames/40,0.85);
            } else { state.threeFrames=0; }
            if(state.threeReady && Rh.present && Rh.pinching && !state.confirmed){
                state.confirmed=true; return 1;
            }
            return state.confirmed?1:0;
        }
    },
    color: {
        id:"color", emoji:"", name:"Open color palette",
        desc:"Extend your <b>ring + pinky fingers</b> on your left hand, then <b>right pinch</b> to pick a color.",
        hands:[{label:"Pinky + angular left",side:"L"},{label:"Right pinch",side:"R"}],
        hint:"Extend angular + pinky, then right pinch on a color", next:"clear",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lg.pinky){
                state.pinkyReady=true;
                state.pinkyFrames=(state.pinkyFrames||0)+1;
                if(!state.confirmed) return Math.min(state.pinkyFrames/25,0.85);
            } else { state.pinkyFrames=0; }
            if(state.pinkyReady && state.colorChanged){ state.confirmed=true; return 1; }
            return state.confirmed?1:0;
        }
    },
    clear: {
        id:"clear", emoji:"", name:"Clear canvas",
        desc:"Make a <b>peace sign </b> with your left hand, then <b>right pinch</b> to clear all lines.",
        hands:[{label:"Peace left",side:"L"},{label:"Right pinch",side:"R"}],
        hint:"Left peace sign → Right pinch", next:"brush",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lg.peace){
                state.peaceReady=true;
                state.peaceFrames=(state.peaceFrames||0)+1;
                if(!state.confirmed) return Math.min(state.peaceFrames/40,0.85);
            } else { state.peaceFrames=0; }
            if(state.peaceReady && Rh.present && Rh.pinching && !state.confirmed){
                state.confirmed=true; return 1;
            }
            return state.confirmed?1:0;
        }
    },
    brush: {
        id:"brush", emoji:"", name:"Change brush size",
        desc:"Make a <b>fist </b> with your left hand, then <b>right pinch</b> to cycle brush sizes.",
        hands:[{label:"Fist left",side:"L"},{label:"Right pinch",side:"R"}],
        hint:"Left fist - Right pinch", next:"ai",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lg.fist){
                state.fistReady=true;
                state.fistFrames=(state.fistFrames||0)+1;
                if(!state.confirmed) return Math.min(state.fistFrames/40,0.85);
            } else { state.fistFrames=0; }
            if(state.fistReady && Rh.present && Rh.pinching && !state.confirmed){
                state.confirmed=true; return 1;
            }
            return state.confirmed?1:0;
        }
    },
    ai: {
        id:"ai", emoji:"", name:"Analyze with AI",
        desc:"Extend your <b>left thumb</b>, then <b>right pinch</b> to send your drawing to AI.",
        hands:[{label:"Thumb left",side:"L"},{label:"Right pinch",side:"R"}],
        hint:"Left thumb up → Right pinch", next:"draw",
        check:(Lg,Rg,Lh,Rh,state)=>{
            if(Lh.present && Lg.thumb){
                state.thumbReady=true;
                state.thumbFrames=(state.thumbFrames||0)+1;
                if(!state.confirmed) return Math.min(state.thumbFrames/40,0.85);
            } else { state.thumbFrames=0; }
            if(state.thumbReady && Rh.present && Rh.pinching && !state.confirmed){
                state.confirmed=true; return 1;
            }
            return state.confirmed?1:0;
        }
    }
};

const S = {
    ready:false,
    L:makeHand(), R:makeHand(),
    gestureState:{},
    progress:0, done:false,
    lastFrameTime:0,
    strokes:[],       
    demoStrokes:[],   
    eraseStrokes:[],  
    erCur:null,
    cur:null,
    brushIdx:1,          
    brushSizes:[2,5,10,18],
    brushLabels:["Fine","Medium","Thick","XL"],
    ci:0,       
    peaceOrigin:{x:0,y:0},
    peaceHov:null,
    peaceOpen:false,
};

function makeHand(){
    return{present:false,lms:null,ip:null,buf:[],pinchFrames:0,pinching:false,wasPinch:false,_smoothed:{}};
}

const cv         = document.getElementById("canvas");
const cx         = cv.getContext("2d");
const loadScreen = document.getElementById("loadScreen");
const loadMsg    = document.getElementById("loadMsg");
const gEmoji     = document.getElementById("gEmoji");
const gName      = document.getElementById("gName");
const gDesc      = document.getElementById("gDesc");
const gHands     = document.getElementById("gHands");
const detectArea = document.getElementById("detectArea");
const successArea= document.getElementById("successArea");
const successSub = document.getElementById("successSub");
const progCircle = document.getElementById("progCircle");
const progRing   = document.getElementById("progRing");
const progLabel  = document.getElementById("progLabel");
const gestureHint= document.getElementById("gestureHint");
const hdotL      = document.getElementById("hdotL");
const hdotR      = document.getElementById("hdotR");
const nextBtn    = document.getElementById("nextBtn");
const listBtn    = document.getElementById("listBtn");

new ResizeObserver(()=>{
    cv.width=cv.offsetWidth; cv.height=cv.offsetHeight;
    if(S.ready) spawnDemoStrokes();
}).observe(cv);
cv.width=cv.offsetWidth; cv.height=cv.offsetHeight;

const params    = new URLSearchParams(window.location.search);
const gestureId = params.get("g") || "draw";
const gesture   = GESTURES[gestureId] || GESTURES.draw;

function populateUI(){
    gEmoji.textContent = gesture.emoji;
    gName.textContent  = gesture.name;
    gDesc.innerHTML    = gesture.desc;
    gestureHint.textContent = gesture.hint;
    gHands.innerHTML = gesture.hands.map(h=>
        `<span class="hand-badge ${h.side}">${h.label}</span>`
    ).join("");
    const nextG = GESTURES[gesture.next];
    nextBtn.textContent = nextG ? `Next: ${nextG.name} →` : "Back to list";
    successSub.textContent = "You can now use this gesture in AIR Drawing!";
}
populateUI();

function spawnDemoStrokes(){
    const W=cv.width, H=cv.height;
    if(!["erase","clear","undo"].includes(gestureId)) return;
    S.demoStrokes=[];
    S.eraseStrokes=[];

    if(gestureId==="erase"){
        S.demoStrokes=[{
            c:"#00f5ff", w:8,
            pts: Array.from({length:30},(_,i)=>({
                x: W*0.2 + (W*0.6)*(i/29),
                y: H*0.5 + Math.sin(i/3)*18
            }))
        }];
    }
    if(gestureId==="clear"){
        S.demoStrokes=[
            {c:"#00f5ff",w:6,pts:Array.from({length:20},(_,i)=>({x:W*0.15+(W*0.3)*(i/19),y:H*0.35+Math.sin(i/2)*20}))},
            {c:"#bf00ff",w:6,pts:Array.from({length:20},(_,i)=>({x:W*0.3+(W*0.4)*(i/19),y:H*0.55+Math.cos(i/2)*22}))},
            {c:"#00ff88",w:6,pts:Array.from({length:20},(_,i)=>({x:W*0.45+(W*0.4)*(i/19),y:H*0.45+Math.sin(i/3)*16}))},
        ];
    }
    if(gestureId==="undo"){
        S.demoStrokes=[
            {c:"#00f5ff",w:5,pts:Array.from({length:15},(_,i)=>({x:W*0.2+(W*0.2)*(i/14),y:H*0.4+Math.sin(i/2)*15}))},
            {c:"#bf00ff",w:5,pts:Array.from({length:15},(_,i)=>({x:W*0.35+(W*0.25)*(i/14),y:H*0.55+Math.cos(i/2)*15}))},
            {c:"#ff6b00",w:5,pts:Array.from({length:15},(_,i)=>({x:W*0.5+(W*0.3)*(i/14),y:H*0.45+Math.sin(i/3)*15}))},
        ];
    }
}

function checkDemoRegenerate(){
    if(gestureId==="erase" && S.demoStrokes.length===0){
        spawnDemoStrokes();
    }
    if(gestureId==="clear" && S.demoStrokes.length===0){
        spawnDemoStrokes();
    }
    if(gestureId==="undo" && S.demoStrokes.length===0){
        spawnDemoStrokes();
    }
}

function detectRaw(lms, side){
    const up=(t,p)=>lms[t].y<lms[p].y;
    const i=up(8,6), m=up(12,10), r=up(16,14), p=up(20,18);
    const thumbExt = side==='R' ? lms[4].x>lms[3].x : lms[4].x<lms[3].x;
    const d=Math.hypot(lms[8].x-lms[4].x,lms[8].y-lms[4].y,lms[8].z-lms[4].z);
    return {
        pinch:   d<PINCH_D,
        indexUp: i,
        peace:   i&&m&&!r&&!p&&!thumbExt,
        three:   i&&m&&r&&!p&&!thumbExt,
        fist:    !i&&!m&&!r&&!p&&!thumbExt,
        thumb:   thumbExt&&!i&&!m&&!r&&!p,
        pinky: thumbExt && !i && !m && !r && p && true, 
    };
}

function smooth(hand, raw){
    hand.buf.push(raw);
    if(hand.buf.length>SMOOTH_N) hand.buf.shift();
    const n=hand.buf.length, out={};
    for(const k of Object.keys(raw)){
        out[k]=hand.buf.filter(g=>g[k]).length>=Math.ceil(n*SMOOTH_THRESH);
    }
    return out;
}

const lm2c = lm=>({x:(1-lm.x)*cv.width, y:lm.y*cv.height});

function assignSide(lms){
    const side=lms[0].x<0.5?'R':'L';
    return SWAP_HANDS?(side==='L'?'R':'L'):side;
}

function handleModeInteraction(){
    const Lh=S.L, Rh=S.R;
    const Lg=Lh._smoothed||{}, Rg=Rh._smoothed||{};

    if(S.done) return;

    if(gestureId==="draw"){
        if(Lh.present && Lh.pinching && Rh.present){
            if(!S.cur){ S.cur={c:PAL[S.ci].v, w:S.brushSizes[S.brushIdx], pts:[{...Rh.ip}]}; }
            else S.cur.pts.push({...Rh.ip});
        } else {
            if(S.cur && S.cur.pts.length>1) S.strokes.push(S.cur);
            S.cur=null;
        }
    }

    if(gestureId==="erase"){
        if(Rh.present && Rh.pinching && Lh.present && Lh.ip){
            if(!S.erCur){ S.erCur={w:18, pts:[{...Lh.ip}]}; }
            else S.erCur.pts.push({...Lh.ip});
            checkDemoFullyErased();
        } else {
            if(S.erCur && S.erCur.pts.length>1) S.eraseStrokes.push(S.erCur);
            S.erCur=null;
        }
        checkDemoRegenerate();
    }

    if(gestureId==="undo"){
        const didConfirm = S.gestureState.threeReady && Rh.present && Rh.pinching && !Rh.wasPinch;
        if(didConfirm && S.demoStrokes.length>0){
            S.demoStrokes.pop();
        }
        checkDemoRegenerate();
    }

    if(gestureId==="color"){
        if(Lh.present && Lg.pinky){
            S.peaceOpen=true;
            S.peaceOrigin=lm2c(Lh.lms[9]);
            if(Rh.present) updatePeaceHover(Rh.ip);
            if(Rh.present && Rh.pinching && !Rh.wasPinch && S.peaceHov!==null){
                const prevCi=S.ci;
                S.ci=S.peaceHov;
                if(S.ci!==prevCi) S.gestureState.colorChanged=true;
                S.peaceOpen=false;
            }
        } else {
            S.peaceOpen=false; S.peaceHov=null;
        }
    }

    if(gestureId==="clear"){
        const didConfirm = S.gestureState.peaceReady && Rh.present && Rh.pinching && !Rh.wasPinch;
        if(didConfirm){ S.demoStrokes=[]; S.eraseStrokes=[]; }
        checkDemoRegenerate();
    }

    if(gestureId==="brush"){
        const didConfirm = S.gestureState.fistReady && Rh.present && Rh.pinching && !Rh.wasPinch && !S.gestureState.confirmed;
        if(didConfirm) S.brushIdx=(S.brushIdx+1)%S.brushSizes.length;
    }
}

function checkDemoFullyErased(){

    const erasePts = S.eraseStrokes.reduce((a,s)=>a+s.pts.length,0) +
                     (S.erCur ? S.erCur.pts.length : 0);
    if(erasePts > 60) S.demoStrokes=[];
}

function wheelPt(i){
    const a=(i/PAL.length)*Math.PI*2-Math.PI/2;
    return{x:S.peaceOrigin.x+Math.cos(a)*WHEEL_R, y:S.peaceOrigin.y+Math.sin(a)*WHEEL_R};
}
function updatePeaceHover(rip){
    for(let i=0;i<PAL.length;i++){
        if(Math.hypot(rip.x-wheelPt(i).x, rip.y-wheelPt(i).y)<28){ S.peaceHov=i; return; }
    }
    S.peaceHov=null;
}

function setProgress(p){
    const offset=188-p*188;
    progCircle.style.strokeDashoffset=offset;
    progLabel.textContent=Math.round(p*100)+"%";
    if(p>=1){ progRing.classList.add("done"); progCircle.style.stroke="#00ff88"; }
}

function showSuccess(){
    S.done=true;
    detectArea.classList.add("hide");
    successArea.classList.add("show");
    gestureHint.textContent="🎉 Gesture completed!";
}

function renderStroke(s,tc,alpha){
    const{c,w,pts}=s; if(!pts||pts.length<2) return;
    tc.save(); tc.globalAlpha=alpha||1;
    tc.strokeStyle=c||"#fff"; tc.lineWidth=w; tc.lineCap="round"; tc.lineJoin="round";
    tc.shadowColor=c||"#fff"; tc.shadowBlur=w*2;
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
    cx.fillStyle="rgba(5,5,16,.35)"; cx.fillRect(0,0,W,H);

    if(gestureId==="draw"){
        for(const s of S.strokes) renderStroke(s,cx);
        if(S.cur) renderStroke(S.cur,cx);
    }

    if(gestureId==="erase"){
        const off=document.createElement("canvas"); off.width=W; off.height=H;
        const oc=off.getContext("2d");
        for(const s of S.demoStrokes) renderStroke(s,oc);
        oc.globalCompositeOperation='destination-out';
        for(const s of S.eraseStrokes) renderStroke(s,oc);
        if(S.erCur) renderStroke(S.erCur,oc);
        oc.globalCompositeOperation='source-over';
        cx.drawImage(off,0,0);
        if(S.L.present && S.L.ip){
            cx.save(); cx.beginPath(); cx.arc(S.L.ip.x,S.L.ip.y,14,0,Math.PI*2);
            cx.strokeStyle="rgba(255,255,255,.7)"; cx.lineWidth=2;
            cx.setLineDash([4,4]); cx.stroke(); cx.setLineDash([]); cx.restore();
        }
    }

    if(gestureId==="undo"){
        for(const s of S.demoStrokes) renderStroke(s,cx);
        if(S.demoStrokes.length>0){
            cx.save(); cx.font="bold 12px 'Space Grotesk',sans-serif"; cx.textAlign="center";
            cx.fillStyle="rgba(255,255,255,.3)"; cx.fillText("← undo this",cv.width*.65,cv.height*.35);
            cx.restore();
        }
    }

    if(gestureId==="clear"){
        for(const s of S.demoStrokes) renderStroke(s,cx);
    }

    if(gestureId==="color"){
        cx.save(); cx.font="bold 13px 'Space Grotesk',sans-serif"; cx.textAlign="center";
        cx.fillStyle=PAL[S.ci].v; cx.shadowColor=PAL[S.ci].v; cx.shadowBlur=14;
        cx.fillText(`Current color: ${PAL[S.ci].n}`, W/2, H*0.12);
        cx.restore();
        if(S.peaceOpen) drawWheel();
    }

    if(gestureId==="brush"){
        const bw=S.brushSizes[S.brushIdx];
        cx.save();
        cx.beginPath(); cx.arc(W/2,H/2,bw/2+4,0,Math.PI*2);
        cx.fillStyle=PAL[S.ci].v; cx.shadowColor=PAL[S.ci].v; cx.shadowBlur=16; cx.fill();
        cx.font="bold 13px 'Space Grotesk',sans-serif"; cx.textAlign="center";
        cx.fillStyle="rgba(255,255,255,.4)"; cx.shadowBlur=0;
        cx.fillText(`${S.brushLabels[S.brushIdx]} brush`, W/2, H/2+bw/2+22);
        cx.restore();
    }

    drawCursors();
    drawHandLabels();
}

function drawWheel(){
    const{x:ox,y:oy}=S.peaceOrigin, n=PAL.length;
    cx.save(); cx.beginPath(); cx.arc(ox,oy,WHEEL_R+44,0,Math.PI*2);
    cx.fillStyle="rgba(0,0,0,.65)"; cx.fill(); cx.restore();
    for(let i=0;i<n;i++){
        const p=wheelPt(i), hov=i===S.peaceHov, rad=hov?24:16;
        cx.save();
        if(hov){cx.shadowColor=PAL[i].v; cx.shadowBlur=24;}
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
    if(S.L.present && S.L.lms && gestureId!=="erase"){
        const w=lm2c(S.L.lms[0]);
        cx.save(); cx.beginPath(); cx.arc(w.x,w.y,13,0,Math.PI*2);
        cx.strokeStyle="rgba(0,245,255,.5)"; cx.lineWidth=1.5;
        cx.setLineDash([4,4]); cx.stroke(); cx.setLineDash([]); cx.restore();
    }
    if(S.R.present && S.R.ip){
        const pos=S.R.ip;
        cx.save();
        cx.beginPath(); cx.arc(pos.x,pos.y,12,0,Math.PI*2);
        cx.strokeStyle="rgba(191,0,255,.7)"; cx.lineWidth=1.5;
        cx.setLineDash([5,5]); cx.stroke(); cx.setLineDash([]);
        cx.beginPath(); cx.arc(pos.x,pos.y,3,0,Math.PI*2);
        cx.fillStyle="rgba(191,0,255,.8)"; cx.fill();
        cx.restore();
    }
}

function drawHandLabels(){
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

const vid=document.createElement("video");
vid.autoplay=true; vid.playsInline=true; vid.muted=true;
let hl, lastVT=-1;

function loop(now){
    requestAnimationFrame(loop);
    if(!S.ready) return;
    if(now-S.lastFrameTime<MS_PER_FRAME) return;
    S.lastFrameTime=now;

    if(vid.readyState>=2){
        if(vid.currentTime!==lastVT){
            lastVT=vid.currentTime;
            const result=hl.detectForVideo(vid,now);

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

            for(const side of ['L','R']){
                const hand=S[side];
                if(hand.present){
                    hand.wasPinch=hand.pinching;
                    const raw=detectRaw(hand.lms, side);
                    hand._smoothed=smooth(hand,raw);
                    hand.pinchFrames=hand._smoothed.pinch?Math.min(hand.pinchFrames+1,PINCH_CONFIRM+2):0;
                    hand.pinching=hand.pinchFrames>=PINCH_CONFIRM;
                } else {
                    hand.buf=[]; hand.pinchFrames=0; hand.pinching=false; hand.wasPinch=false; hand._smoothed={};
                }
            }

            handleModeInteraction();

            if(!S.done){
                const prog=gesture.check(
                    S.L._smoothed||{}, S.R._smoothed||{},
                    S.L, S.R, S.gestureState
                );
                S.progress=prog;
                setProgress(prog);
                if(prog>=1) showSuccess();
            }

            hdotL.classList.toggle("on",S.L.present);
            hdotR.classList.toggle("on",S.R.present);
        }
    }
    drawFrame();
}

nextBtn.addEventListener("click",()=>{
    if(GESTURES[gesture.next]) window.location.href=`practice.html?g=${gesture.next}`;
    else window.location.href="index.html";
});
listBtn.addEventListener("click",()=>window.location.href="index.html");

async function init(){
    try{
        loadMsg.textContent="Loading MediaPipe…";
        const fs=await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        hl=await HandLandmarker.createFromOptions(fs,{
            baseOptions:{
                modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate:"CPU"
            },
            runningMode:"VIDEO", numHands:2,
            minHandDetectionConfidence:0.45,
            minHandPresenceConfidence:0.45,
            minTrackingConfidence:0.4
        });
        loadMsg.textContent="Accessing camera…";
        const stream=await navigator.mediaDevices.getUserMedia({
            video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"}
        });
        vid.srcObject=stream;
        await new Promise(r=>{vid.onloadedmetadata=()=>{vid.play();r();};});
        spawnDemoStrokes();
        loadMsg.textContent="Ready!";
        await new Promise(r=>setTimeout(r,500));
        loadScreen.classList.add("fade");
        await new Promise(r=>setTimeout(r,500));
        loadScreen.style.display="none";
        S.ready=true;
        requestAnimationFrame(loop);
    } catch(e){
        loadMsg.textContent="Error: "+e.message;
        console.error(e);
    }
}
init();
