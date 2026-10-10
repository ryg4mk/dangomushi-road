/* ONE TAKE GAME #008 — 爆走！ダンゴムシロード
   No assets, libraries or external services. */
(() => {
  'use strict';

  const ROAD_HALF = 3.8;
  const PLAYER_Z = 10;
  const PLAYER_RADIUS = 0.49;
  const PLAYER_X_LIMIT = ROAD_HALF - 0.64;
  const VIEW_DISTANCE = 205;
  const ROLL_SECONDS = 0.82;
  const COOLDOWN_SECONDS = 4.0; // after the rolling animation ends
  const STORAGE_BEST = 'dangomushi-road-best-v1';
  const STORAGE_TUTORIAL = 'dangomushi-road-tutorial-v1';
  const STORAGE_MUTED = 'dangomushi-road-muted-v1';
  const obstacleTypes = [
    { id:'pebble', rx:.45, height:.45, depth:.62, tone:'#9b9882' },
    { id:'rock', rx:.72, height:.94, depth:.87, tone:'#827e6a' },
    { id:'twig', rx:.88, height:.24, depth:.72, tone:'#755039' },
    { id:'acorn', rx:.48, height:.6, depth:.66, tone:'#94582c' },
    { id:'leaves', rx:.73, height:.40, depth:.80, tone:'#c48244' },
    { id:'can', rx:.56, height:.82, depth:.71, tone:'#8da8a3' },
    { id:'pot', rx:.67, height:.65, depth:.8, tone:'#bd7654' },
    { id:'plank', rx:.93, height:.27, depth:.77, tone:'#a47b4b' },
    { id:'root', rx:1.10, height:.40, depth:.86, tone:'#65503b' }
  ];
  const byType = Object.fromEntries(obstacleTypes.map(o => [o.id,o]));
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const shell = document.getElementById('gameShell');
  const hud = document.getElementById('hud');
  const distanceEl = document.getElementById('distance');
  const bestEl = document.getElementById('best');
  const titleScreen = document.getElementById('titleScreen');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const startButton = document.getElementById('startButton');
  const retryButton = document.getElementById('retryButton');
  const rollWrap = document.getElementById('rollWrap');
  const rollButton = document.getElementById('rollButton');
  const rollStatus = document.getElementById('rollStatus');
  const slideHint = document.getElementById('slideHint');
  const rollHint = document.getElementById('rollHint');
  const newBest = document.getElementById('newBest');
  const soundButton = document.getElementById('soundButton');
  const $ = (id) => document.getElementById(id);
  const clamp = (n,a,b) => Math.min(b, Math.max(a,n));
  const mix = (a,b,t) => a + (b-a)*t;
  const ease = (t) => t*t*(3-2*t);
  const format = n => Math.floor(n).toLocaleString('en-US');
  function storageRead(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return fallback; } }
  function storageWrite(k,v) { try { localStorage.setItem(k,String(v)); } catch { /* embedded/private mode: continue to play */ } }
  function hash(n) { let x = Math.imul(n|0, 0x45d9f3b); x = Math.imul(x ^ (x>>>16), 0x45d9f3b); return ((x ^ (x>>>16)) >>> 0) / 4294967296; }
  function randRange(random,a,b) { return a + (b-a)*random(); }
  function createRandom(seed=1) { let s=seed>>>0; return () => { s += 0x6D2B79F5; let t=s; t=Math.imul(t ^ t>>>15,t|1); t^=t+Math.imul(t ^ t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
  function stageOf(distance) { return Math.floor(Math.max(0,distance)/500); }
  function speedOf(distance) { const stage=stageOf(distance); return Math.min(31.5, 14.5 + stage*2.2 + (distance%500)/500*1.35); }
  function gapOf(distance,random) {
    const stage=stageOf(distance);
    const mean=Math.max(34, 74-stage*5.2);
    return mean + randRange(random,-mean*.11,mean*.13);
  }
  function typeFor(distance,random) {
    const stage=stageOf(distance);
    const unlocked = stage < 1 ? 5 : stage < 2 ? 7 : obstacleTypes.length;
    return obstacleTypes[Math.floor(random()*unlocked)];
  }

  // Every row has a continuous safe corridor. Consecutive safe corridors are
  // kept close enough that even keyboard steering can reach the next one.
  class Course {
    constructor(seed=1) {
      this.random=createRandom(seed);
      this.rows=[];
      this.obstacles=[];
      this.next=138;
      this.safeX=0;
      this.serial=0;
    }
    fill(throughDistance) {
      while (this.next < throughDistance) {
        const distance=this.next;
        const stage=stageOf(distance);
        const target=clamp(this.safeX + randRange(this.random,-1.15,1.15),-2.35,2.35);
        // At the beginning, center is always an easy escape path.
        const safeX = distance < 230 ? 0 : target;
        const number = stage===0 ? 1 : stage===1 ? (this.random()<.28?2:1) :
          stage===2 ? (this.random()<.52?2:1) :
          (this.random()<Math.min(.82,.54+stage*.028)?2:1);
        const candidates=[];
        // Build hazard footprints outside the safe corridor, keeping hazards separate.
        for (let n=0;n<number;n++) {
          let placed=false;
          for (let attempt=0;attempt<45 && !placed;attempt++) {
            const type=typeFor(distance,this.random);
            let x=randRange(this.random,-PLAYER_X_LIMIT+.08,PLAYER_X_LIMIT-.08);
            if (distance < 230) { // forbid center-line instant deaths in the training area
              x = (this.random()<.5?-1:1)*randRange(this.random,1.65,2.85);
            }
            const safeClearance = type.rx + PLAYER_RADIUS + .24;
            if (Math.abs(x-safeX) < safeClearance) continue;
            if (candidates.some(other => Math.abs(x-other.x) < other.rx+type.rx+.28)) continue;
            candidates.push({ id:++this.serial, type:type.id, x, at:distance, rx:type.rx, depth:type.depth, hit:false });
            placed=true;
          }
        }
        // If the random proposals could not fit, a sparse row is always preferable
        // to constructing an unavoidable wall.
        this.rows.push({ at:distance, safeX, obstacles:candidates });
        this.obstacles.push(...candidates);
        this.safeX=safeX;
        this.next += gapOf(distance,this.random);
      }
    }
    prune(currentDistance) {
      while (this.obstacles.length && this.obstacles[0].at < currentDistance-8) this.obstacles.shift();
      while (this.rows.length && this.rows[0].at < currentDistance-20) this.rows.shift();
    }
  }

  let W=390,H=730,dpr=1;
  function resize() {
    const box=shell.getBoundingClientRect();
    W=Math.max(1,box.width); H=Math.max(1,box.height);
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();
  window.addEventListener('resize',resize,{passive:true});
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(shell);

  let mode='title', distance=0, gameTime=0, elapsed=0, playerX=0, course=new Course(817);
  let initialBest=Math.max(0,Number(storageRead(STORAGE_BEST,'0'))||0), best=initialBest;
  let hasShownBest=false, nextStoreAt=0, rollEnd=0, cooldownEnd=0;
  let flipTime=0, impactTime=0, shake=0, slowUntil=0, bounce=0;
  let particles=[], pointerId=null, pointerLastX=0, pointerLastAt=0;
  let tutorialSeen=storageRead(STORAGE_TUTORIAL,'0')==='1';
  let muted=storageRead(STORAGE_MUTED,'0')==='1';
  let soundContext=null, lastFrame=0;
  const pressed=new Set();
  soundButton.classList.toggle('muted',muted);
  soundButton.setAttribute('aria-label',muted?'効果音をオンにする':'効果音をミュート');

  function initSound() {
    if (muted) return;
    try { if (!soundContext) soundContext = new (window.AudioContext||window.webkitAudioContext)();
      if (soundContext.state==='suspended') soundContext.resume().catch(()=>{});
    } catch { /* No Web Audio: visual game still works. */ }
  }
  function tone(freq, duration=.1, wave='sine', volume=.07, delay=0, endFreq=null) {
    if (muted||!soundContext) return;
    try {
      const now=soundContext.currentTime+delay, o=soundContext.createOscillator(), gain=soundContext.createGain();
      o.type=wave; o.frequency.setValueAtTime(Math.max(1,freq),now);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),now+duration);
      gain.gain.setValueAtTime(.0001,now); gain.gain.exponentialRampToValueAtTime(volume,now+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
      o.connect(gain);gain.connect(soundContext.destination);o.start(now);o.stop(now+duration+.025);
    } catch { /* audio may be unavailable */ }
  }
  function sfx(name) {
    if (name==='start') { tone(440,.10,'triangle',.09);tone(615,.13,'triangle',.08,.10);tone(830,.18,'triangle',.07,.20); }
    if (name==='roll') { tone(580,.12,'triangle',.11,0,260);tone(340,.16,'sine',.07,.09,500); }
    if (name==='guard') { tone(175,.14,'triangle',.14,0,92);tone(380,.07,'square',.025,.05,190); }
    if (name==='over') { tone(340,.2,'triangle',.08,0,240);tone(245,.23,'triangle',.08,.14,130);tone(130,.32,'sine',.06,.30,91); }
    if (name==='best') { tone(570,.10,'sine',.07);tone(760,.1,'sine',.07,.1);tone(960,.2,'triangle',.08,.20); }
  }
  soundButton.addEventListener('click',() => {
    muted=!muted;
    storageWrite(STORAGE_MUTED,muted?'1':'0');
    soundButton.classList.toggle('muted',muted);
    soundButton.setAttribute('aria-label',muted?'効果音をオンにする':'効果音をミュート');
    if (!muted) { initSound();tone(700,.09); }
  });

  function start() {
    initSound();sfx('start');
    mode='running';distance=0;gameTime=0;elapsed=0;playerX=0;
    course=new Course((Date.now() ^ Math.floor(Math.random()*0xffffff))>>>0);
    course.fill(VIEW_DISTANCE+20);
    initialBest=Math.max(0,Number(storageRead(STORAGE_BEST,'0'))||0,best);
    best=initialBest;
    hasShownBest=false;firstBestTime=null;nextStoreAt=Math.max(initialBest+20,20);
    rollEnd=0;cooldownEnd=0;flipTime=0;impactTime=0;shake=0;slowUntil=0;bounce=0;
    particles=[];pointerId=null;pressed.clear();
    titleScreen.classList.add('hidden');gameOverScreen.classList.add('hidden');
    hud.classList.remove('hidden');rollWrap.classList.remove('hidden');
    newBest.classList.add('hidden');
    distanceEl.textContent='0';bestEl.textContent=format(best);
    if(!tutorialSeen) {
      slideHint.classList.remove('hidden');rollHint.classList.remove('hidden');
      tutorialSeen=true;storageWrite(STORAGE_TUTORIAL,'1');
    } else { slideHint.classList.add('hidden');rollHint.classList.add('hidden'); }
    updateRollButton();
  }
  startButton.addEventListener('click',start);
  retryButton.addEventListener('click',start);
  const rolling = () => mode==='running' && gameTime<rollEnd;
  function triggerRoll() {
    if (mode!=='running'||gameTime < cooldownEnd-0.00001) return false;
    initSound();sfx('roll');
    rollEnd=gameTime+ROLL_SECONDS;
    cooldownEnd=rollEnd+COOLDOWN_SECONDS;
    addParticles(playerX, PLAYER_Z, 11, ['#ecf4b0','#b9eac5','#fef6db'],.9);
    updateRollButton();
    return true;
  }
  rollButton.addEventListener('pointerdown',(e)=>e.stopPropagation());
  rollButton.addEventListener('click',e=>{e.stopPropagation();triggerRoll();});
  function updateRollButton() {
    const isRolling=rolling();
    const ready=mode==='running' && gameTime >= cooldownEnd;
    const remaining=Math.max(0,cooldownEnd-gameTime);
    let charge=1;
    if (remaining>0) charge = isRolling ? 0 : clamp(1-(cooldownEnd-gameTime)/COOLDOWN_SECONDS,0,1);
    rollButton.style.setProperty('--charge',charge.toFixed(3));
    rollButton.disabled=!ready;
    rollButton.classList.toggle('rolling',isRolling);
    rollStatus.textContent=isRolling?'GUARD!':ready?'READY!':'CHARGING';
  }
  function moveByPixels(dx) {
    if(mode!=='running')return;
    // Relative displacement; never set X from the initial touch coordinate.
    const unitPerPixel=(ROAD_HALF*2)/(roadHalfPixels(PLAYER_Z)*2);
    const maxDelta=1.35; // prevents skipping the whole road after a stalled pointer event
    playerX=clamp(playerX+clamp(dx*unitPerPixel*1.12,-maxDelta,maxDelta),-PLAYER_X_LIMIT,PLAYER_X_LIMIT);
  }
  canvas.addEventListener('pointerdown',e=>{
    if(mode!=='running'||pointerId!==null)return;
    pointerId=e.pointerId;pointerLastX=e.clientX;pointerLastAt=performance.now();
    try {canvas.setPointerCapture(e.pointerId);} catch {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(mode!=='running'||pointerId!==e.pointerId)return;
    const dx=e.clientX-pointerLastX;
    moveByPixels(dx);pointerLastX=e.clientX;pointerLastAt=performance.now();
    e.preventDefault();
  });
  function endPointer(e) {if(e.pointerId===pointerId){pointerId=null;}}
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
  window.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight',' ','KeyA','KeyD'].includes(e.code))e.preventDefault();
    pressed.add(e.code);
    if((e.code==='Space'||e.code==='ArrowDown')&&mode==='running'&&!e.repeat)triggerRoll();
    if((e.code==='Enter')&&!e.repeat&&(mode==='title'||mode==='over')) {e.preventDefault();start();}
  });
  window.addEventListener('keyup',e=>pressed.delete(e.code));
  window.addEventListener('blur',()=>{pressed.clear();pointerId=null;lastFrame=0;});

  function addParticles(x,z,count,colors,power=1) {
    const p=project(x,z);
    for(let i=0;i<count;i++) {
      const a=Math.random()*Math.PI*2,v=(35+Math.random()*110)*power;
      particles.push({x:p.x,y:p.y-20,vx:Math.cos(a)*v,vy:Math.sin(a)*v-40,
        ttl:.3+Math.random()*.35,max:.65,r:2+Math.random()*4,color:colors[i%colors.length]});
    }
  }
  function collision(o) {
    o.hit=true;
    if(rolling()) {
      sfx('guard');impactTime=.23;shake=3.5;bounce=.32;slowUntil=gameTime+.47;
      addParticles(o.x,PLAYER_Z,13,['#f9efd0','#e9c375','#e5f7b0'],1.0);
    } else {
      mode='crash';flipTime=0;shake=2.6;
      addParticles(playerX,PLAYER_Z,13,['#e6d3a0','#a48a62','#e9ca83'],.75);
      sfx('over');
      finalizeRecord();
    }
  }
  function finalizeRecord() {
    const achieved=Math.floor(distance);
    if(achieved>best)best=achieved;
    storageWrite(STORAGE_BEST,Math.max(best,achieved));
  }
  function showGameOver() {
    mode='over';
    hud.classList.add('hidden');rollWrap.classList.add('hidden');
    slideHint.classList.add('hidden');rollHint.classList.add('hidden');newBest.classList.add('hidden');
    $('finalDistance').textContent=format(distance);
    $('finalBest').textContent=format(best);
    $('overMessage').textContent=distance>initialBest&&initialBest>0?'最高記録を更新！ もう一走り！':'もう一度、爆走しよう！';
    gameOverScreen.classList.remove('hidden');
  }
  function update(dt) {
    elapsed+=dt;
    if(mode==='running') {
      gameTime+=dt;
      const keyboard=(pressed.has('ArrowRight')||pressed.has('KeyD')?1:0)-(pressed.has('ArrowLeft')||pressed.has('KeyA')?1:0);
      if(keyboard)playerX=clamp(playerX+keyboard*5.8*dt,-PLAYER_X_LIMIT,PLAYER_X_LIMIT);
      const speed=speedOf(distance)*(gameTime<slowUntil?.77:1);
      const before=distance;
      distance+=dt*speed;
      course.fill(distance+VIEW_DISTANCE);
      // Collision is swept across the forward distance traveled this frame, not
      // dependent on matching exactly one animation frame.
      for(const o of course.obstacles) {
        if(o.hit||o.at<before-1.15||o.at>distance+1.15)continue;
        if(Math.abs(o.x-playerX) < o.rx+PLAYER_RADIUS) {
          collision(o);
          if(mode!=='running')break;
        } else if(o.at<=distance) o.hit=true;
      }
      course.prune(distance);
      const achieved=Math.floor(distance);
      if(achieved>best)best=achieved;
      if(!hasShownBest && achieved > (initialBest>0?initialBest:99)) {
        hasShownBest=true;newBest.classList.remove('hidden');sfx('best');
      }
      if(achieved>=nextStoreAt) {storageWrite(STORAGE_BEST,best);nextStoreAt=achieved+25;}
      distanceEl.textContent=format(achieved);bestEl.textContent=format(best);
      updateRollButton();
      if(gameTime>3.0){slideHint.classList.add('hidden');rollHint.classList.add('hidden');}
      if(hasShownBest&&gameTime>1.9 && !newBest.classList.contains('hidden')) {
        // The CSS animation can also end independently; hide after a short interval.
        const shownAt = firstBestTime??gameTime;
        if(gameTime-shownAt>1.9)newBest.classList.add('hidden');
      }
      if(hasShownBest&&firstBestTime===null)firstBestTime=gameTime;
    } else if(mode==='crash') {
      flipTime+=dt;
      if(flipTime>=1.07)showGameOver();
    }
    if(impactTime>0) impactTime-=dt;
    if(bounce>0)bounce-=dt;
    if(shake>0)shake=Math.max(0,shake-dt*15);
    for(const p of particles){p.ttl-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=150*dt;}
    particles=particles.filter(p=>p.ttl>0);
  }
  let firstBestTime=null;

  function projectionT(z) {return 24/(Math.max(0,z)+24);}
  function horizonY() {return H*.185;}
  function groundBottom() {return H*1.04;}
  function roadCenter(z) {return W*.5+Math.sin((distance+z)*.0028)*W*.018;}
  function roadHalfPixels(z) {const t=projectionT(z);return W*(.029+.565*t);}
  function project(x,z) {
    const t=projectionT(z);
    return {x:roadCenter(z) + x/ROAD_HALF*roadHalfPixels(z),y:horizonY()+(groundBottom()-horizonY())*t,
      unit:roadHalfPixels(z)/ROAD_HALF,t};
  }
  function ellipse(x,y,rx,ry,fill,alpha=1) {
    ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(x,y,Math.max(.2,rx),Math.max(.2,ry),0,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function roundRect(x,y,w,h,r,fill) {
    ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
  }
  function roadPath(from,to,extra=0) {
    const a=project(0,from),b=project(0,to),wa=roadHalfPixels(from)+extra,wb=roadHalfPixels(to)+extra;
    ctx.beginPath();ctx.moveTo(a.x-wa,a.y);ctx.lineTo(a.x+wa,a.y);ctx.lineTo(b.x+wb,b.y);ctx.lineTo(b.x-wb,b.y);ctx.closePath();
  }
  function colorLerp(a,b,t) {return Math.round(mix(a,b,t));}
  function terrainColors() {
    const c=(Math.sin(distance*.0018)+1)*.5;
    return {grass:`rgb(${colorLerp(100,119,c)},${colorLerp(152,177,c)},${colorLerp(97,110,c)})`,
      soil:`rgb(${colorLerp(156,174,c)},${colorLerp(116,133,c)},${colorLerp(78,91,c)})`};
  }
  function drawWorld() {
    const colors=terrainColors();
    const sky=ctx.createLinearGradient(0,0,0,H*.45);
    sky.addColorStop(0,'#b4ded3');sky.addColorStop(.57,'#d0e8c3');sky.addColorStop(1,'#9abd7a');
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    // Far trees and shrub silhouettes remain gentle rather than forming a jungle.
    for(let i=0;i<18;i++) {
      const x=(i-.5)*W/16-8;
      const y=horizonY()+10+hash(i*13)*17;
      ellipse(x,y,22+hash(i+90)*32,13+hash(i+20)*21,'#6d9b73',.48);
      ellipse(x+11,y+10,29,8,'#70a37a',.67);
    }
    ctx.fillStyle=colors.grass;ctx.fillRect(0,horizonY()+14,W,H);
    const glow=ctx.createLinearGradient(0,horizonY(),0,H);
    glow.addColorStop(0,'#d1d9a41f');glow.addColorStop(1,'#3e754a36');
    ctx.fillStyle=glow;ctx.fillRect(0,horizonY(),W,H);
    // Road is composed of connected trapezoids; projected width grows toward the player.
    for(let far=VIEW_DISTANCE;far>0;far-=7) {
      const near=Math.max(0,far-7), pos=distance+far;
      roadPath(far,near,8*projectionT(far));
      ctx.fillStyle='#5c724e';ctx.fill();
      roadPath(far,near);
      const shade=(Math.floor(pos/8)%3);
      ctx.fillStyle=shade===0?'#b49365':shade===1?'#ae8960':'#b18d63';ctx.fill();
    }
    const roadShade=ctx.createLinearGradient(0,horizonY(),0,H);
    roadShade.addColorStop(0,'#d5bd8c18');roadShade.addColorStop(1,'#70472f20');
    roadPath(VIEW_DISTANCE,0);ctx.fillStyle=roadShade;ctx.fill();
    // Slightly lighter traveled tracks give texture and clarify the perspective.
    for(const x of [-2.1,2.1]){
      ctx.beginPath();for(let z=VIEW_DISTANCE;z>=0;z-=8){const p=project(x,z);if(z===VIEW_DISTANCE)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
      ctx.strokeStyle='#eac99544';ctx.lineWidth=Math.max(1,W*.014);ctx.stroke();
    }
    drawRoadTexture();drawScenery();
  }
  function drawRoadTexture() {
    const start=Math.floor(distance/4)*4;
    for(let at=start;at<distance+VIEW_DISTANCE;at+=4) {
      const z=at-distance+PLAYER_Z;
      if(z<0||z>VIEW_DISTANCE)continue;
      const k=Math.floor(at/4);
      for(let j=0;j<3;j++) {
        const xx=(hash(k*37+j*81)*2-1)*3.45;
        const p=project(xx,z);
        const s=clamp(p.unit/36,.08,2.8);
        ellipse(p.x,p.y,Math.max(.4,(1.0+hash(k*53+j)*1.9)*s),Math.max(.25,(.35+hash(k*77+j)*.7)*s),j===1?'#eee0ac':'#755940',.34);
        if(j===0 && k%5===0) {
          ctx.strokeStyle='#e5c79f55';ctx.lineWidth=Math.max(.5,s*.8);
          ctx.beginPath();ctx.moveTo(p.x,p.y-1*s);ctx.lineTo(p.x+4*s,p.y-9*s);ctx.stroke();
        }
      }
    }
  }
  function drawScenery() {
    const begin=Math.floor((distance-PLAYER_Z)/9)-1;
    const end=Math.ceil((distance+VIEW_DISTANCE)/9);
    for(let k=end;k>=begin;k--) {
      for(let side=-1;side<=1;side+=2) {
        const d=k*9+hash(k*15+side*7)*6;
        const z=d-distance+PLAYER_Z;
        if(z<0||z>VIEW_DISTANCE)continue;
        const x=side*(ROAD_HALF+rand01(k*33+side*41)*2.7);
        const p=project(x,z);
        const s=clamp(p.unit/37,.055,2.8);
        const kind=(Math.floor(hash(k*57+side*3)*7)+(Math.floor(distance/410)%3))%7;
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
        if(kind<=2)drawGrass(k,side);
        else if(kind===3)drawFlower(k);
        else if(kind===4)drawLeaf(k);
        else if(kind===5)drawRoot(k);
        else drawSideStone(k);
        ctx.restore();
      }
    }
  }
  function rand01(n){return hash(n+1919);}
  function drawGrass(k,side) {
    ellipse(0,0,21,5,'#3a7643',.29);
    for(let j=0;j<6;j++) {
      const dir=(j-2.5)*.38+side*.08, ht=15+hash(k*25+j)*19;
      ctx.beginPath();ctx.moveTo(-8+j*3.3,1);ctx.quadraticCurveTo(dir*10,-ht*.63,dir*16,-ht);
      ctx.strokeStyle=j%2?'#4d8848':'#377b49';ctx.lineWidth=2.2;ctx.lineCap='round';ctx.stroke();
    }
  }
  function drawFlower(k) {
    ctx.strokeStyle='#397443';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(1,-25);ctx.stroke();
    for(let a=0;a<5;a++){const th=a*Math.PI*2/5;ellipse(Math.cos(th)*8,-25+Math.sin(th)*8,5,5,k%2?'#f7d4a0':'#f5ebdc');}
    ellipse(0,-25,4,4,'#f2b64b');
    ellipse(-4,-10,8,3,'#4b9656');
  }
  function drawLeaf(k) {
    ctx.save();ctx.rotate(hash(k*11)*6.28);
    ellipse(0,-6,14,7,k%2?'#c49b50':'#b56c42');
    ctx.strokeStyle='#f2cf7855';ctx.beginPath();ctx.moveTo(-13,-6);ctx.lineTo(13,-6);ctx.stroke();ctx.restore();
  }
  function drawRoot(k) {
    ctx.lineCap='round';ctx.strokeStyle='#705239';ctx.lineWidth=7;
    ctx.beginPath();ctx.moveTo(-22,3);ctx.quadraticCurveTo(-5,-13,18,-3);ctx.stroke();
    ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(7,-19);ctx.stroke();
  }
  function drawSideStone(k) {
    ellipse(0,2,18,5,'#465b3a',.28);
    ctx.fillStyle=k%2?'#9d9c82':'#c6bea1';ctx.beginPath();ctx.moveTo(-14,-2);ctx.lineTo(-7,-14);ctx.lineTo(7,-17);ctx.lineTo(16,-4);ctx.lineTo(10,1);ctx.lineTo(-10,1);ctx.fill();
    ctx.fillStyle='#e7dfc9a3';ctx.beginPath();ctx.moveTo(-9,-9);ctx.lineTo(-3,-15);ctx.lineTo(4,-13);ctx.lineTo(1,-7);ctx.fill();
  }

  function drawObstacles(nearOnly) {
    // Projected obstacle depth determines draw order relative to the player.
    for(let i=course.obstacles.length-1;i>=0;i--) {
      const o=course.obstacles[i];
      const z=o.at-distance+PLAYER_Z;
      if(z<-.8||z>VIEW_DISTANCE)continue;
      if((z<PLAYER_Z)!==nearOnly)continue;
      const p=project(o.x,Math.max(0,z));
      const s=clamp(p.unit/39,.045,2.1);
      if(o.hit&&mode==='running'&&o.at<distance-2)continue;
      ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
      drawObstacleShape(o.type,o.id);
      ctx.restore();
    }
  }
  function drawObstacleShape(type,id) {
    const t=byType[type], shade=t.tone;
    ellipse(0,2,t.rx*47,11,'#493924',.27);
    const path=(points,fill,stroke=null,width=2)=>{
      ctx.beginPath();ctx.moveTo(points[0],points[1]);for(let i=2;i<points.length;i+=2)ctx.lineTo(points[i],points[i+1]);ctx.closePath();
      ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
    };
    if(type==='pebble'||type==='rock') {
      const r=type==='rock'?31:20;
      path([-r,-2,-r*.78,-r*.82,-r*.18,-r*1.32,r*.47,-r*1.09,r,-r*.45,r*.86,1],shade,'#5d6456',2);
      path([-r*.77,-r*.77,-r*.18,-r*1.25,r*.47,-r*1.03,r*.05,-r*.59],'#d4d1b4a9');
      ctx.strokeStyle='#6f746780';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-5,-19);ctx.lineTo(7,-12);ctx.stroke();
    } else if(type==='twig'||type==='root') {
      ctx.lineCap='round';ctx.strokeStyle='#4b3428';ctx.lineWidth=type==='root'?14:9;
      ctx.beginPath();ctx.moveTo(-t.rx*37,-3);ctx.quadraticCurveTo(0,-19,t.rx*37,-5);ctx.stroke();
      ctx.strokeStyle='#9c7652';ctx.lineWidth=3.4;ctx.beginPath();ctx.moveTo(-t.rx*36,-8);ctx.quadraticCurveTo(0,-22,t.rx*28,-10);ctx.stroke();
      for(let j=-1;j<=1;j+=2){ctx.strokeStyle='#65452d';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(j*21,-11);ctx.lineTo(j*28,-26);ctx.stroke();}
    } else if(type==='acorn') {
      ellipse(0,-16,18,24,'#9e5c37');ellipse(0,-28,19,11,'#69412e');
      ctx.strokeStyle='#cf9959';ctx.lineWidth=1.6;for(let j=-13;j<=12;j+=8){ctx.beginPath();ctx.moveTo(j,-33);ctx.lineTo(j+6,-26);ctx.stroke();}
      ctx.strokeStyle='#6a492c';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(1,-36);ctx.lineTo(5,-45);ctx.stroke();
      ellipse(-6,-11,5,8,'#ce9762',.5);
    } else if(type==='leaves') {
      for(let j=0;j<7;j++) {
        const a=j*2.37+id*.4,x=Math.sin(a)*22,y=-8-Math.cos(a)*6;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);
        ellipse(0,0,15,7,['#c77a39','#e6b154','#996e40'][j%3]);
        ctx.strokeStyle='#f3cb7555';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(12,0);ctx.stroke();ctx.restore();
      }
    } else if(type==='can') {
      ctx.save();ctx.rotate(-.22);
      roundRect(-18,-33,36,30,7,'#8faeab');
      ctx.fillStyle='#d9ebdc';ctx.fillRect(-18,-25,36,7);
      ellipse(0,-33,18,6,'#4b6b68');ellipse(0,-33,13,3,'#a8bab2');
      ellipse(0,-3,18,5,'#5a7d7c');
      ctx.strokeStyle='#f5f3d8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-11,-23);ctx.lineTo(-11,-12);ctx.stroke();ctx.restore();
    } else if(type==='pot') {
      path([-27,-34,27,-34,22,-6,-20,-5],'#ba7652','#824e38');
      roundRect(-30,-37,60,9,2,'#d28a62');
      path([7,-34,11,-17,0,-8,4,-5],'#92573d');
      ctx.strokeStyle='#f2bc91';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-16,-30);ctx.lineTo(-9,-11);ctx.stroke();
    } else if(type==='plank') {
      path([-39,-4,-32,-17,34,-17,41,-6,38,2,-36,2],'#a77c4d','#775437',2);
      ctx.strokeStyle='#dfb17e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-30,-13);ctx.lineTo(29,-13);ctx.moveTo(-25,-5);ctx.lineTo(12,-5);ctx.stroke();
      ellipse(-26,-8,2,2,'#624632');ellipse(28,-8,2,2,'#624632');
    }
  }

  function drawDango() {
    const p=project(playerX,PLAYER_Z);
    const s=clamp(p.unit/40,.62,1.25);
    const t=elapsed;
    const shaking=(Math.sin(t*65)*.75+Math.sin(t*99)*.25);
    const bob=(mode==='running'?Math.sin(t*24)*2.1:0);
    const jumping=bounce>0?Math.sin((.32-bounce)/.32*Math.PI)*13:0;
    ctx.save();ctx.translate(p.x,p.y+bob-jumping);ctx.scale(s,s);
    ellipse(0,4,39,11,'#3b3128',.23);
    if(mode==='crash'||mode==='over') {
      const phase=mode==='crash'?ease(clamp(flipTime/.62,0,1)):1;
      ctx.translate(0,-20-Math.sin(phase*Math.PI)*13);
      ctx.rotate(phase*Math.PI*.95);
      drawUnrolled(t,true);
    } else if(rolling()) {
      ctx.translate(0,-22-Math.abs(Math.sin(t*19))*5);
      ctx.rotate((distance*.042)% (Math.PI*2));
      drawRolled();
    } else {
      const opening=rollEnd>0&&gameTime>rollEnd&&gameTime<rollEnd+.17 ? (gameTime-rollEnd)/.17 : 1;
      ctx.translate(0,-(1-opening)*6);
      ctx.scale(mix(.83,1,opening),mix(.96,1,opening));
      drawUnrolled(t,false,shaking);
    }
    ctx.restore();
  }
  function drawUnrolled(t,upsideDown,shaking=0) {
    ctx.save();
    const scuttle=upsideDown?0:Math.sin(t*44);
    // Multiple tiny legs, not just a generic circular character.
    ctx.strokeStyle='#34453a';ctx.lineWidth=3.2;ctx.lineCap='round';
    for(let side of [-1,1])for(let i=0;i<5;i++){
      const y=-8-i*7, stride=scuttle*(i%2?1:-1)*4;
      ctx.beginPath();ctx.moveTo(side*28,y-5);ctx.lineTo(side*(36+stride*.4),y+stride);
      ctx.lineTo(side*(39+stride*.55),y+4+stride*.7);ctx.stroke();
    }
    // Tapered layered plated body; front end points away from the camera.
    ctx.fillStyle='#3c5946';ctx.beginPath();ctx.moveTo(-29,-14);ctx.quadraticCurveTo(-40,-33,-26,-57);ctx.quadraticCurveTo(0,-83,27,-56);ctx.quadraticCurveTo(40,-33,29,-14);ctx.quadraticCurveTo(0,9,-29,-14);ctx.fill();
    ctx.fillStyle='#68885d';ctx.beginPath();ctx.moveTo(-28,-15);ctx.quadraticCurveTo(-37,-38,-23,-55);ctx.quadraticCurveTo(0,-76,23,-55);ctx.quadraticCurveTo(36,-38,28,-15);ctx.quadraticCurveTo(0,2,-28,-15);ctx.fill();
    // Curved segment lines lend a roly-poly silhouette.
    for(let i=0;i<5;i++) {
      const y=-15-i*10, width=28-(i>2?(i-2)*3:0);
      ctx.strokeStyle=i%2?'#41644f':'#3b5846';ctx.lineWidth=4.3-i*.12;
      ctx.beginPath();ctx.moveTo(-width,y);ctx.quadraticCurveTo(0,y+11,width,y);ctx.stroke();
    }
    ellipse(-12,-41,7,17,'#a8b891',.18);
    // A small head and two short antennae are visible at the leading tip.
    ellipse(0,-65,20,15,'#6b8b5c');
    ctx.strokeStyle='#3b5846';ctx.lineWidth=2.5;
    for(const side of [-1,1]){
      ctx.beginPath();ctx.moveTo(side*9,-70);ctx.quadraticCurveTo(side*14,-84,side*21,-86);ctx.stroke();
      ellipse(side*21,-86,2.8,3.2,'#496b49');
      ellipse(side*10,-67,2.2,2.4,'#263c32');
    }
    ctx.restore();
  }
  function drawRolled() {
    ellipse(0,0,31,31,'#354e41');
    const sphere=ctx.createRadialGradient(-11,-16,4,1,0,36);
    sphere.addColorStop(0,'#b6c79c');sphere.addColorStop(.45,'#7d9d70');sphere.addColorStop(1,'#365544');
    ellipse(0,0,28,29,sphere);
    ctx.strokeStyle='#45634e';ctx.lineWidth=4;
    for(let i=-2;i<=2;i++){
      const x=i*10;
      ctx.beginPath();ctx.moveTo(x,-Math.sqrt(Math.max(0,25*25-x*x)));
      ctx.quadraticCurveTo(x+8,0,x,Math.sqrt(Math.max(0,25*25-x*x)));ctx.stroke();
    }
    ellipse(-9,-13,9,5,'#eaf0c3',.28);
    ctx.strokeStyle='#d2e5b3a8';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,23,-2.1,-.6);ctx.stroke();
  }
  function drawSpeedFX() {
    if(mode!=='running')return;
    const speed=speedOf(distance), amount=Math.round(mix(6,16,(speed-14.5)/(31.5-14.5)));
    const seed=Math.floor(distance*2);
    ctx.save();ctx.lineCap='round';
    for(let i=0;i<amount;i++) {
      const k=seed+i*17;
      const x=(hash(k*31)*2-1)*W*.50+W*.5;
      if(x>W*.28&&x<W*.72)continue;
      const y=H*(.2+hash(k*23)*.7);
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(x-W*.5)*.025,y+13+speed*.8);
      ctx.strokeStyle='#fff8d7';ctx.globalAlpha=.08+(speed/32)*.18;
      ctx.lineWidth=1+hash(k+7)*1.5;ctx.stroke();
    }
    ctx.restore();
  }
  function drawParticles() {
    for(const p of particles)ellipse(p.x,p.y,p.r*clamp(p.ttl/p.max,.1,1),p.r*clamp(p.ttl/p.max,.1,1),p.color,clamp(p.ttl/.4,0,.94));
  }
  function render() {
    ctx.save();
    if(shake>0)ctx.translate(Math.sin(elapsed*101)*shake*.38,Math.cos(elapsed*75)*shake*.28);
    drawWorld();
    drawObstacles(false);
    drawDango();
    drawObstacles(true);
    drawSpeedFX();drawParticles();
    // Warm foreground edge vegetation helps reinforce the viewpoint.
    const fg=ctx.createLinearGradient(0,H*.8,0,H);
    fg.addColorStop(0,'#406b3510');fg.addColorStop(1,'#2f59301e');
    ctx.fillStyle=fg;ctx.fillRect(0,H*.8,W,H*.2);
    ctx.restore();
  }
  function frame(now) {
    const dt=lastFrame?clamp((now-lastFrame)/1000,0,.05):0;
    lastFrame=now;
    update(dt);render();
    requestAnimationFrame(frame);
  }
  course.fill(VIEW_DISTANCE+140);
  requestAnimationFrame(frame);

  // Test-only surface: available with ?test=1, does not change normal gameplay.
  if(new URLSearchParams(location.search).has('test') || window.__DANGO_FORCE_TEST__) {
    window.__DANGO_TEST__={
      Course,createRandom,stageOf,speedOf,gapOf,ROAD_HALF,PLAYER_X_LIMIT,PLAYER_RADIUS,ROLL_SECONDS,COOLDOWN_SECONDS,
      project,resize,moveByPixels,start,triggerRoll,update,render,
      getState:()=>({mode,distance,playerX,gameTime,rollEnd,cooldownEnd,best,initialBest,
        rows:course.rows.map(r=>({at:r.at,safeX:r.safeX,obstacles:r.obstacles.map(o=>({...o}))}))}),
      setPlayerX:x=>{playerX=clamp(x,-PLAYER_X_LIMIT,PLAYER_X_LIMIT);},
      setDistance:x=>{distance=x;course.fill(distance+VIEW_DISTANCE);},
      forceObstacle:(x,at,type='rock')=>{const t=byType[type];course.obstacles.unshift({id:999999,type,x,at,rx:t.rx,depth:t.depth,hit:false});}
    };
  }
})();
