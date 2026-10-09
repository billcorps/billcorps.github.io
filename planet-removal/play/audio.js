const MATERIAL_INDEX={ROCK:1,ICE:2,CHEESE:3,GLASS:4,METAL:5,LAVA:6,OCEAN:7,VERDANT:8};
const TYPE_INDEX={SMALL:0,MASSIVE:1,HYPERGIANT:2};

/** Browser output for the game's original native PCM score/effect synthesizer. */
export class BrowserAudio {
  constructor(settings) {
    this.settings={...settings};this.context=null;this.active=true;this.closed=false;
    this.score=0;this.sceneKey='';this.generation=null;this.previous=null;
    this.effectBuffers=new Map();this.effects=[];this.musicSources=new Set();this.nextMusic=0;
    this.timer=setInterval(()=>this.fillMusic(),40);
  }
  get native() { return globalThis.PlanetRemovalNative?.NativeAudio; }
  async unlock() {
    if(this.closed)return;
    const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!AudioContext)return;
    if(!this.context) {
      this.context=new AudioContext({latencyHint:'interactive'});
      this.musicGain=this.context.createGain();this.musicGain.gain.value=.8;
      this.musicGain.connect(this.context.destination);
      this.effectGain=this.context.createGain();this.effectGain.gain.value=1;
      this.effectGain.connect(this.context.destination);
    }
    if(this.active&&this.context.state!=='running')await this.context.resume().catch(()=>{});
    if(!this.musicSources.size)this.nextMusic=this.context.currentTime+.025;
    if(this.previous)this.configureScene(this.previous);
    this.fillMusic();
  }
  setSettings(settings) {
    this.settings={...settings};
    if(!settings.sound)this.stopEffects();
    if(!settings.music)this.stopMusic();
  }
  configure(settings) { this.setSettings(settings); }
  resume() { this.active=true;if(this.context)this.context.resume().catch(()=>{}); }
  pause() { this.active=false;this.stopMusic();this.stopEffects();this.context?.suspend().catch(()=>{}); }
  configureScene(snapshot) {
    if(!this.native||!this.context)return;
    const hud=snapshot.hud||{},type=TYPE_INDEX[snapshot.stellar?.type]||0;
    const key=`${hud.seed}:${hud.level}:${type}`;
    if(!this.score) {
      this.musicRate=Math.max(8000,Math.min(96000,this.context.sampleRate));
      this.score=this.native.createScore(String(hud.seed||'0'),hud.level||1,type,this.musicRate);
      this.pcm=new Int16Array(Math.ceil(this.musicRate*.08)*2);
      this.sceneKey=key;
    } else if(key!==this.sceneKey) {
      this.native.scoreScene(this.score,String(hud.seed||'0'),hud.level||1,type);this.sceneKey=key;
    }
    const threshold=hud.stellarWarningThreshold||({SMALL:.28,MASSIVE:.18,HYPERGIANT:.12}[snapshot.stellar?.type]??.28);
    this.native.scoreTension(this.score,Math.max(0,Math.min(1,(snapshot.stellar?.removedFraction||0)/threshold)));
  }
  fillMusic() {
    if(this.closed||!this.active||!this.settings.music||!this.score||!this.native||this.context?.state!=='running')return;
    const c=this.context;
    if(this.nextMusic<c.currentTime)this.nextMusic=c.currentTime+.015;
    // Keep a small bounded queue. Hidden pages and pauses discard queued sources.
    for(let count=0;count<3&&this.musicSources.size<3&&this.nextMusic<c.currentTime+.16;count++) {
      const frames=this.pcm.length/2;
      this.native.renderScore(this.score,this.pcm,0,frames);
      const buffer=this.toBuffer(this.pcm,this.musicRate,2);
      const node=c.createBufferSource();node.buffer=buffer;node.connect(this.musicGain);
      node.onended=()=>{this.musicSources.delete(node);node.disconnect();};
      this.musicSources.add(node);node.start(this.nextMusic);this.nextMusic+=frames/this.musicRate;
    }
  }
  toBuffer(samples,rate,channels=2) {
    const frames=Math.floor(samples.length/channels),buffer=this.context.createBuffer(channels,frames,rate);
    const scale=samples instanceof Int16Array?1/32768:1;
    for(let channel=0;channel<channels;channel++) {
      const output=buffer.getChannelData(channel);
      for(let i=0;i<frames;i++)output[i]=samples[i*channels+channel]*scale;
    }
    return buffer;
  }
  playPCM(samples,rate=24000,{channels=2,volume=1,playbackRate=1}={}) {
    if(!this.active||!this.settings.sound||this.context?.state!=='running'||!samples?.length)return;
    this.playBuffer(this.toBuffer(samples,rate,channels),volume,playbackRate);
  }
  playBuffer(buffer,volume,rate=1) {
    while(this.effects.length>=6) {
      const old=this.effects.shift();try{old.node.stop();}catch{/* Already ended. */}old.gain.disconnect();
    }
    const c=this.context,node=c.createBufferSource(),gain=c.createGain();
    gain.gain.value=Math.max(0,Math.min(1,volume));node.buffer=buffer;
    node.playbackRate.value=Math.max(.5,Math.min(2,rate));node.connect(gain);gain.connect(this.effectGain);
    const entry={node,gain};this.effects.push(entry);
    node.onended=()=>{this.effects=this.effects.filter(e=>e!==entry);node.disconnect();gain.disconnect();};node.start();
  }
  effect(index,volume=.35,rate=1) {
    if(!this.native||!this.active||!this.settings.sound||this.context?.state!=='running')return;
    let buffer=this.effectBuffers.get(index);
    if(!buffer){buffer=this.toBuffer(this.native.synthesize(index),24000,1);this.effectBuffers.set(index,buffer);}
    this.playBuffer(buffer,volume,rate);
  }
  update(snapshot) {
    this.configureScene(snapshot);
    const prior=this.previous;this.previous=snapshot;
    if(!prior||prior.generation!==snapshot.generation)return;
    const hud=snapshot.hud||{},star=snapshot.stellar,oldStar=prior.stellar;
    if(hud.shots>(prior.hud?.shots||0))this.effect(0,.33);
    const oldImpacts=new Set((prior.impacts||[]).map(i=>String(i.id)));
    for(const event of snapshot.impacts||[])if(!oldImpacts.has(String(event.id))&&event.age<.25) {
      const body=(snapshot.bodies||[]).find(b=>b.id===event.body);
      const index=MATERIAL_INDEX[body?.material?.name]||1;
      this.effect(event.explosion?index+16:index,event.explosion?.64:.22+.36*event.power,.92+.14*event.power);
      if(this.settings.haptics&&globalThis.navigator?.vibrate)navigator.vibrate(event.explosion?30:12);
    }
    if(snapshot.solarSplash&&snapshot.solarSplash.id!==prior.solarSplash?.id)this.effect(10,.38+.21*snapshot.solarSplash.power);
    if(star&&oldStar&&star.phase!==oldStar.phase) {
      const size=TYPE_INDEX[star.type]||0,rate=1.1-.14*size;
      if(star.phase==='UNSTABLE')this.effect(13,.32);
      if(star.phase==='EXPANDING')this.effect(25,.34+.06*size,rate);
      if(star.phase==='COLLAPSING')this.effect(14,.43,rate);
      if(star.phase==='ERUPTING')this.effect(26,.54+.1*size,rate);
      if(star.remnant==='BLACK_HOLE') {
        this.stopEffects();
        const p=star.playerPosition,distance=Math.hypot(p?.x||0,p?.y||0,p?.z||0);
        const outside=Math.max(0,distance/Math.max(.001,star.captureRadius)-1);
        this.effect(15,.12/(1+outside*outside));
      }
    }
    if(star?.gameOver&&!oldStar?.gameOver)this.effect(star.defeatCause==='CAPTURED'?16:27,star.defeatCause==='CAPTURED'?.18:.21);
    this.fillMusic();
  }
  stopMusic() {
    for(const node of this.musicSources){try{node.stop();}catch{/* Already ended. */}node.disconnect();}
    this.musicSources.clear();this.nextMusic=this.context?this.context.currentTime+.02:0;
  }
  stopEffects() {
    for(const {node,gain} of this.effects){try{node.stop();}catch{/* Already ended. */}node.disconnect();gain.disconnect();}
    this.effects=[];
  }
  dispose() {
    this.closed=true;clearInterval(this.timer);this.stopMusic();this.stopEffects();
    if(this.score&&this.native)this.native.destroyScore(this.score);this.score=0;this.context?.close().catch(()=>{});
  }
}
