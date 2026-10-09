import { PlanetRenderer } from './renderer.js';
import { GameUI, showLoading, showFailure } from './ui.js';
import { BrowserStorage } from './storage.js';
import { BrowserAudio } from './audio.js';
import { LauncherInput } from './input.js';

let runtime,renderer,ui,input,audio;
let stopped=false,lastTime=0,accumulator=0,simulationElapsed=0,lastSave=0,hiddenScreen=null;

function resize() {
  if(!renderer)return;
  const game=document.getElementById('game'),safe=getComputedStyle(document.getElementById('safe-area'));
  const top=parseFloat(safe.paddingTop)||0,bottom=parseFloat(safe.paddingBottom)||0;
  const {width,height}=game.getBoundingClientRect();
  renderer.resize(width,height,top,bottom);runtime?.resize(width,height,top,bottom,1);
  if(ui?.snapshot)ui.sync(runtime.snapshot());
}
function fail(error,loading=false) {
  stopped=true;input?.cancel();audio?.pause();ui?.save();
  console.error('Planet Removal stopped.',error);
  showFailure(error?.message?.includes('WebGL 2')?error.message:
    loading?'The game could not finish loading. Check your connection, then try again.':
      'The game was interrupted. Your last saved run is still on this device. Reload to continue.');
}
function draw(frame) {
  const snapshot=frame?.bodies?frame:runtime.snapshot();renderer.render(snapshot);runtime.ack(snapshot.generation,snapshot.revision);
  ui.sync(snapshot);
  try { audio.update(snapshot); }
  catch(error){console.warn('Browser audio stopped.',error);audio.pause();}
}
function frame(timestamp) {
  if(stopped)return;
  requestAnimationFrame(frame);
  if(document.hidden){lastTime=0;accumulator=0;simulationElapsed=0;return;}
  if(!lastTime){lastTime=timestamp;draw();return;}
  const elapsed=Math.max(0,Math.min(.05,(timestamp-lastTime)/1000));lastTime=timestamp;
  accumulator+=elapsed;simulationElapsed+=elapsed;
  // Refresh-rate-independent 60 Hz ceiling; no simulation catches up a hidden page.
  if(accumulator<1/60-.0002)return;
  const dt=Math.min(.04,simulationElapsed);simulationElapsed=0;
  accumulator=Math.max(0,accumulator-1/60)% (1/60);
  try {
    draw(runtime.tick(dt));
    if(timestamp-lastSave>8000){ui.save();lastSave=timestamp;}
  }catch(error){fail(error);}
}

async function boot() {
  try {
    const storage=new BrowserStorage();audio=new BrowserAudio(storage.readSettings());
    renderer=new PlanetRenderer(document.getElementById('world'));resize();
    const {createPlanetRemovalRuntime}=await import('./runtime.js');
    runtime=await createPlanetRemovalRuntime({storage,audio,onProgress:showLoading});
    runtime.setSettings(storage.readSettings());resize();
    ui=new GameUI(runtime,renderer,storage,audio);
    input=new LauncherInput(document.getElementById('interaction'),runtime,
      ()=>({screen:ui.screen,snapshot:ui.snapshot,layout:renderer.layout}),
      drag=>ui.setDrag(drag),()=>audio.unlock().catch(()=>{}));
    ui.attachInput(input);
    new ResizeObserver(resize).observe(document.getElementById('game'));
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden) {
        input.cancel();ui.save();hiddenScreen=ui.overlayReturn||ui.screen;
        runtime.pause(true);audio.pause();
        if(ui.screen==='PLAY')ui.show('PAUSE');
      } else {
        lastTime=0;accumulator=0;simulationElapsed=0;
        if(hiddenScreen==='MENU')runtime.menu();
        else if(hiddenScreen==='DEFEAT'||hiddenScreen==='RESULTS')runtime.pause(false);
        if(!['PAUSE','SETTINGS','LEADERBOARD'].includes(ui.screen))audio.resume();
        resize();
      }
    });
    window.addEventListener('pagehide',()=>{input.cancel();ui.save();audio.pause();});
    window.addEventListener('blur',()=>input.cancel());
    document.getElementById('world').addEventListener('webglcontextlost',event=>{
      event.preventDefault();fail(new Error('Graphics context lost'));
    });
    draw();requestAnimationFrame(frame);
  }catch(error){fail(error,true);}
}
boot();
