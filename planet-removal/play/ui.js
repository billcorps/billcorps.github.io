import { project } from './projection.js';

const $ = id => document.getElementById(id);
const format = value => String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const causes = { INSTABILITY:'The star became unstable.', CLIENT_DAMAGED:'The client planet took damage.',
  CAPTURED:'Captured by the stellar remnant.', ENVELOPED:'The expanding star engulfed you.',
  BLAST:'The supernova caught up.' };

export class GameUI {
  constructor(runtime,renderer,storage,audio) {
    this.runtime=runtime;this.renderer=renderer;this.storage=storage;this.audio=audio;
    this.screen='LOADING';this.overlayReturn=null;this.snapshot=null;this.drag=null;this.markers=new Map();
    this.settings=storage.readSettings();this.abort=new AbortController();
    const options={signal:this.abort.signal};
    $('game').append($('toast'));
    $('game').addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');
      if(button&&!button.disabled)this.action(button.dataset.action).catch(error=>this.handleError(error));
    },options);
    for(const input of document.querySelectorAll('.setting input')) {
      input.checked=this.settings[input.name];
      input.addEventListener('change',()=>{
        this.settings[input.name]=input.checked;this.storage.writeSettings(this.settings);
        this.runtime.setSettings(this.settings);this.audio.setSettings(this.settings);
      },options);
    }
    $('cancel-new-run').addEventListener('click',()=>$('new-run-dialog').close(),options);
    $('confirm-new-run').addEventListener('click',()=>{
      $('new-run-dialog').close();this.runtime.newRun();this.overlayReturn=null;
      this.show('PLAY');this.save();$('world').focus({preventScroll:true});
    },options);
    $('save-file').addEventListener('change',event=>this.restore(event.target.files?.[0]),options);
    window.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||$('new-run-dialog').open)return;
      if(this.overlayReturn){this.closeOverlay();event.preventDefault();}
      else if(this.screen==='PLAY'){this.runtime.pause(true);this.show('PAUSE');event.preventDefault();}
      else if(this.screen==='PAUSE'){this.runtime.pause(false);this.show('PLAY');event.preventDefault();}
    },options);
  }
  attachInput(input) { this.input=input; }
  show(screen) {
    if(screen===this.screen)return;
    this.input?.cancel();this.screen=screen;
    for(const element of document.querySelectorAll('#screens>.screen'))element.hidden=element.id!==`screen-${screen}`;
    $('hud').hidden=['LOADING','ERROR'].includes(screen);
    document.querySelector('.flight-header').hidden=screen!=='PLAY';
    $('launcher-container').hidden=screen!=='PLAY';
    if(screen==='PAUSE'||screen==='SETTINGS'||screen==='LEADERBOARD')this.audio.pause();
    else this.audio.resume();
    if(screen!=='PLAY') {
      const heading=$(`screen-${screen}`)?.querySelector('h1');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    }
  }
  sync(snapshot) {
    this.snapshot=snapshot;
    const hud=snapshot.hud||{};
    const screen=hud.screen||(hud.gameOver?'DEFEAT':hud.missionSucceeded?'RESULTS':'MENU');
    if(!this.overlayReturn)this.show(screen);
    $('sector').textContent=`CONTRACT ${String(hud.level||1).padStart(2,'0')}`;
    $('contract-name').textContent=hud.contractName||hud.materialLabel||'Orbital removal';
    $('contract-detail').textContent=[hud.sizeLabel,hud.score!=null?`SCORE ${format(hud.score)}`:''].filter(Boolean).join(' / ');
    const count=hud.targetCount??((snapshot.bodies||[]).filter(b=>b.target).length||1);
    const removed=hud.removedTargets??(count-(hud.targetsRemaining??count));
    $('target-progress').textContent=`${removed} / ${count} REMOVED`;
    $('integrity').value=Number.isFinite(hud.integrity)?hud.integrity:1;
    $('shot-count').textContent=`${hud.shots||0} SHOTS`;
    const star=snapshot.stellar,status=$('stellar-status');
    const phase=star?.phase||'STABLE';
    const phaseNames={STABLE:'STAR STABLE',UNSTABLE:'STELLAR INSTABILITY',EXPANDING:'STELLAR ENVELOPE EXPANDING',
      COLLAPSING:'CORE COLLAPSING',ERUPTING:'STELLAR ERUPTION',REMNANT:star?.remnant?.replaceAll('_',' ')||'STELLAR REMNANT'};
    status.textContent=phaseNames[phase]+(phase==='UNSTABLE'&&star.warningSeconds>0?` / ${star.warningSeconds.toFixed(1)}s`:'');
    status.classList.toggle('warning',phase!=='STABLE');
    $('menu-play').textContent=hud.gameOver?'Play again':hud.shots===0&&hud.level===1?'Begin removal':`Continue · sector ${hud.level||1}`;
    $('results-title').textContent=count===1?'One less planet.':`${count} fewer planets.`;
    $('reward').textContent=`+${format(count*100+(hud.bonus||0))}`;
    $('result-shots').textContent=`${hud.shots||0} SHOTS / ${hud.collateral||0} COLLATERAL`;
    $('result-total').textContent=`TOTAL ${format(hud.score)}`;
    $('next-contract').hidden=!hud.canAdvance;$('result-wait').hidden=!!hud.canAdvance;
    $('defeat-score').textContent=`SCORE ${format(hud.score)}`;
    const cause=star?.defeatCause||hud.defeatCause;
    $('defeat-cause').textContent=cause==='CAPTURED'&&star?.remnant==='BLACK_HOLE'
      ?'Captured by the black hole.':causes[cause]||'The job exceeded its safety margin.';
    $('evacuate').hidden=this.screen!=='PLAY'||!star||['STABLE','REMNANT'].includes(phase)||star.gameOver||star.evacuating||star.escaped;
    if(hud.message&&hud.message!==this.lastMessage){this.lastMessage=hud.message;this.message(hud.message);}
    this.updateMarkers(snapshot);this.updateLauncher();
  }
  updateMarkers(snapshot) {
    const retained=new Set(),layout=this.renderer.layout;
    for(const body of snapshot.bodies||[]) {
      const client=body.client||body.id===2;
      if(body.home||body.destroyed||(!body.target&&!client))continue;
      if(this.screen!=='PLAY'&&!(this.screen==='RESULTS'&&client))continue;
      retained.add(body.id);let marker=this.markers.get(body.id);
      if(!marker) {
        marker=document.createElement('div');marker.className=`body-marker${client?' client':''}`;
        const label=document.createElement('span');label.textContent=client?'CLIENT':'TARGET';marker.append(label);
        $('body-markers').append(marker);this.markers.set(body.id,marker);
      }
      const p=project(body.position,layout),radius=body.radius*layout.scale+9;
      marker.style.width=marker.style.height=`${radius*2}px`;
      marker.style.transform=`translate(${p.x-radius}px,${p.y-radius}px)`;
    }
    for(const [id,marker] of this.markers)if(!retained.has(id)){marker.remove();this.markers.delete(id);}
  }
  setDrag(drag) { this.drag=drag;this.updateLauncher(); }
  updateLauncher() {
    if(!this.snapshot)return;
    const layout=this.renderer.layout,hud=this.snapshot.hud||{},star=this.snapshot.stellar;
    const anchor=star?.playerPosition?project(star.playerPosition,layout):{x:layout.width/2,y:layout.control};
    const container=$('launcher-container');container.style.left=`${anchor.x}px`;
    container.style.top=`${anchor.y}px`;container.style.bottom='auto';
    const aim=this.drag?.aim;const aiming=!!aim?.valid||this.snapshot.aiming;
    const direction=aim||hud.aimDirection||{x:0,y:1};
    const power=aim?.power??hud.aimPower??.8;
    const dx=aim?.valid?-aim.x*aim.pull:0,dy=aim?.valid?aim.y*aim.pull:0;
    $('pull-ball').setAttribute('transform',`translate(${dx},${dy})`);
    $('pull-ball').style.display=hud.canFire||this.drag?'':'none';
    $('empty-launcher').style.display=hud.canFire||this.drag?'none':'';
    $('pull-line').setAttribute('x2',String(dx));$('pull-line').setAttribute('y2',String(dy));
    $('power-ring').style.opacity=aiming?'1':'0';$('power-ring').style.strokeDashoffset=String(213.63*(1-power));
    $('aim-arrow').style.opacity=aiming?'1':'0';
    $('aim-arrow').setAttribute('transform',`rotate(${Math.atan2(direction.x,direction.y)*180/Math.PI})`);
    $('launcher-message').textContent=star?.evacuating?'EVACUATING':hud.canFire?'PULL BACK & RELEASE':this.snapshot.projectile?'FIREBALL IN FLIGHT':'SYSTEM SETTLING';
    $('power-value').textContent=aiming?`${Math.round(power*100)}% POWER`:'';
    $('launcher').setAttribute('aria-disabled',hud.canFire?'false':'true');
  }
  async action(action) {
    await this.audio.unlock();
    switch(action) {
      case 'play':
        if(this.snapshot?.hud?.gameOver)this.runtime.newRun();else this.runtime.start();
        this.overlayReturn=null;this.show('PLAY');$('world').focus({preventScroll:true});break;
      case 'replay':this.runtime.newRun();this.overlayReturn=null;this.show('PLAY');this.save();$('world').focus({preventScroll:true});break;
      case 'new-run':this.input?.cancel();$('new-run-dialog').showModal();break;
      case 'next':this.runtime.next();this.show('PLAY');this.save();$('world').focus({preventScroll:true});break;
      case 'pause':this.runtime.pause(true);this.show('PAUSE');this.save();break;
      case 'resume':
        if(this.snapshot?.hud?.physicsFailed)this.runtime.start();else this.runtime.pause(false);
        this.show('PLAY');$('world').focus({preventScroll:true});break;
      case 'menu':this.runtime.menu();this.overlayReturn=null;this.show('MENU');this.save();break;
      case 'settings':case 'leaderboard':
        this.overlayReturn=this.screen;this.input?.cancel();this.runtime.pause(true);
        this.show(action==='settings'?'SETTINGS':'LEADERBOARD');break;
      case 'close-overlay':this.closeOverlay();break;
      case 'evacuate':this.runtime.evacuate();break;
      case 'fullscreen':
        if(document.fullscreenElement)await document.exitFullscreen();
        else if($('game').requestFullscreen)await $('game').requestFullscreen();
        else this.message('Full screen is unavailable in this browser.');break;
      case 'export-save':this.exportSave();break;
      case 'import-save':$('save-file').click();break;
      case 'reload':location.reload();break;
    }
  }
  closeOverlay() {
    const screen=this.overlayReturn||'MENU';this.overlayReturn=null;
    if(screen==='MENU')this.runtime.menu();
    else this.runtime.pause(screen==='PAUSE');
    this.show(screen);
  }
  save() {
    try { const save=this.runtime.exportSave();if(save)this.storage.writeSave(save); }
    catch(error){console.warn('Could not checkpoint the browser run.',error);}
  }
  exportSave() {
    const save=this.runtime.exportSave();if(!save){this.message('There is no run to back up yet.');return;}
    const url=URL.createObjectURL(new Blob([save],{type:'application/json'})),anchor=document.createElement('a');
    anchor.href=url;anchor.download='planet-removal-save.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async restore(file) {
    $('save-file').value='';if(!file)return;
    if(file.size>8*1024*1024){this.message('That backup is too large. Choose a Planet Removal save.');return;}
    try {
      const save=await file.text(),success=this.runtime.importSave(save);
      if(success===false)throw new Error('Invalid save');
      this.storage.writeSave(save);this.runtime.menu();this.overlayReturn=null;this.show('MENU');
      this.message('Your saved run is ready to continue.');
    }catch(error){console.warn('Save restore failed.',error);this.message('That backup could not be restored. Your current run is unchanged.');}
  }
  message(text) {
    const toast=$('toast');toast.textContent=text;toast.hidden=false;
    clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>toast.hidden=true,3500);
  }
  handleError(error) { console.error(error);this.message('That action could not be completed. Please try again.'); }
  dispose() { this.abort.abort();clearTimeout(this.toastTimer); }
}

export function showLoading(progress) {
  const fraction=typeof progress==='number'?progress:progress?.fraction??progress?.progress;
  if(Number.isFinite(fraction))$('loading-progress').value=Math.max(0,Math.min(1,fraction));
  $('loading-message').textContent=fraction>.75?'Preparing the first contract…':'Loading the game…';
}

export function showFailure(message) {
  for(const screen of document.querySelectorAll('#screens>.screen'))screen.hidden=screen.id!=='screen-ERROR';
  $('hud').hidden=true;$('error-message').textContent=message;
  const heading=$('error-title');heading.tabIndex=-1;heading.focus();
  document.querySelector('[data-action="reload"]').onclick=()=>location.reload();
}
