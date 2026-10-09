import * as THREE from './vendor/three.module.min.js';
import * as S from './shaders.js';
import { projectionLayout, project } from './projection.js';

const MAX_PLASMA = 512, MAX_DEBRIS = 80;
const corners = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
const white = new THREE.Color(1, 1, 1);
const vector = p => new THREE.Vector3(p?.x || 0, p?.y || 0, p?.z || 0);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function raw(vertexShader, fragmentShader, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms,
    glslVersion: THREE.GLSL3, side: THREE.DoubleSide, ...extra });
}
function uniform(value) { return { value }; }
function bodyUniforms() {
  return { uMvp: uniform(new THREE.Matrix4()), uModel: uniform(new THREE.Matrix4()),
    uTint: uniform(new THREE.Vector4(1,1,1,1)), uEmission: uniform(0), uSun: uniform(0),
    uSolarPulse: uniform(0), uSurfaceTime: uniform(0), uBurnPoint: uniform(new THREE.Vector3()),
    uBurnHeat: uniform(0), uHeat: uniform(0), uLiquid: uniform(0), uAperture: uniform(0),
    uAccretion: uniform(0), uCaptureRadius: uniform(0), uPlanet: uniform(0),
    uSurface: uniform(new THREE.Vector4(.9,0,0,0)), uMolten: uniform(0) };
}
function bindMatrices(mesh) {
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (_renderer, _scene, camera, _geometry, material) => {
    const u = material.uniforms;
    if (u.uModel) u.uModel.value.copy(mesh.matrixWorld);
    if (u.uMvp) u.uMvp.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);
  };
  return mesh;
}
function meshGeometry(vertices) {
  const data = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
  if (data.length % 27 !== 0) throw new Error('The simulation returned an incomplete planet mesh.');
  const geometry = new THREE.BufferGeometry(), buffer = new THREE.InterleavedBuffer(data, 9);
  geometry.setAttribute('aPosition', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('aNormal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  geometry.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buffer, 3, 6));
  // Three.js uses the canonical position/count even with custom shader attributes.
  geometry.setAttribute('position', geometry.attributes.aPosition);
  geometry.setDrawRange(0, data.length / 9);
  return geometry;
}
function decoratedGeometry(source) {
  const flat = source.index ? source.toNonIndexed() : source;
  const positions = flat.attributes.position.array, normals = flat.attributes.normal.array;
  const vertices = new Float32Array(positions.length * 3);
  for (let i = 0; i < positions.length / 3; i++) {
    vertices.set(positions.subarray(i*3, i*3+3), i*9);
    vertices.set(normals.subarray(i*3, i*3+3), i*9+3);
    vertices.set([1,1,1], i*9+6);
  }
  const result = meshGeometry(vertices);
  if (flat !== source) flat.dispose(); source.dispose();
  return result;
}
function setPose(mesh, position, scale = 1, spin = 0) {
  mesh.position.set(position?.x || 0, position?.y || 0, position?.z || 0);
  mesh.scale.setScalar(scale); mesh.rotation.set(0, spin, 0);
}
function stellarColor(star) {
  return star?.type === 'MASSIVE' ? new THREE.Vector3(.18,.70,1)
    : star?.type === 'HYPERGIANT' ? new THREE.Vector3(.69,.29,1) : new THREE.Vector3(1,.26,.02);
}

/** WebGL2 rendering of authoritative Java/native snapshots. No browser-side physics. */
export class PlanetRenderer {
  constructor(canvas) {
    const context = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true,
      stencil: false, powerPreference: 'high-performance' });
    if (!context) throw new Error('This game needs WebGL 2. Try a recent browser with hardware acceleration enabled.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x04060e, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.debug.onShaderError = () => { this.shaderFailed = true; };
    this.camera = new THREE.OrthographicCamera(-4,4,7,-9,-24,24);
    this.camera.position.z = 12;
    this.camera.updateMatrixWorld();
    this.world = new THREE.Scene(); this.background = new THREE.Scene();
    this.effectsScene = new THREE.Scene(); this.remnantScene = new THREE.Scene();
    this.meshes = new Map(); this.orbits = new Map(); this.generation = null;
    this.layout = projectionLayout(1,1);
    this.sphere = decoratedGeometry(new THREE.SphereGeometry(1,24,16));
    this.quad = decoratedGeometry(new THREE.PlaneGeometry(2,2));
    this.fireball = bindMatrices(new THREE.Mesh(this.sphere, raw(S.VERTEX,S.FRAGMENT,bodyUniforms())));
    this.fireball.material.uniforms.uEmission.value = 1;
    this.fireball.material.uniforms.uTint.value.set(1,.78,.17,1);
    this.world.add(this.fireball); this.fireball.visible = false;
    this.remnant = bindMatrices(new THREE.Mesh(this.sphere, raw(S.VERTEX,S.FRAGMENT,bodyUniforms())));
    this.remnant.material.uniforms.uEmission.value = 1;
    this.remnant.material.uniforms.uTint.value.set(.79,.91,1,1);
    this.aperture = bindMatrices(new THREE.Mesh(this.quad, raw(S.VERTEX,S.FRAGMENT,bodyUniforms(),
      { transparent: true, depthTest: false, depthWrite: false })));
    this.aperture.material.uniforms.uAperture.value = 1;
    this.remnantScene.add(this.remnant, this.aperture);
    this.remnant.visible = this.aperture.visible = false;
    this.createBackground(); this.createDebris(); this.createEffects();
    this.fluid = new FluidSurface(this.renderer, this.camera);
    this.glow = this.createGlow(); this.effectsScene.add(this.glow);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: 0xffb74c, transparent:true, opacity:.7, depthWrite:false, blending:THREE.AdditiveBlending }));
    this.trail.frustumCulled = false; this.effectsScene.add(this.trail);
    this.metrics = { triangles:0, drawCalls:0, geometries:0, textures:0 };
  }
  resize(width, height, top = 0, bottom = 0) {
    this.layout = projectionLayout(width,height,top,bottom);
    const p = this.layout;
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.setSize(width,height,false);
    Object.assign(this.camera, { left:-p.halfWidth, right:p.halfWidth,
      bottom:p.worldCenterY-p.halfHeight, top:p.worldCenterY+p.halfHeight });
    this.camera.updateProjectionMatrix();
    this.fluid.resize(width,height,this.renderer.getPixelRatio(),false);
  }
  createBackground() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aCorner',new THREE.BufferAttribute(corners,2));
    geometry.setDrawRange(0,6);
    const backgroundMaterial = raw(`precision highp float; in vec2 aCorner; out vec2 vUv;
      void main(){vUv=aCorner*.5+.5;gl_Position=vec4(aCorner,.999,1.);}`,
    `precision highp float; in vec2 vUv; out vec4 outColor;
      void main(){vec2 p=vUv*2.-1.;float fog=exp(-pow(p.y*.7+p.x*.4+.1,2.)*11.);
      float clouds=.5+.5*sin(p.x*4.+sin(p.y*8.))*sin(p.y*5.-p.x*3.);
      vec3 c=vec3(.012,.02,.047)+vec3(.025,.026,.051)*fog*clouds;
      c+=vec3(.006,.023,.03)*exp(-length(p-vec2(.6,.15))*3.);
      outColor=vec4(c,1.);}`,{}, { depthTest:false,depthWrite:false });
    const backgroundQuad=new THREE.Mesh(geometry,backgroundMaterial);
    backgroundQuad.frustumCulled=false;this.background.add(backgroundQuad);
    const stars = new THREE.BufferGeometry();
    const positions=new Float32Array(420*3), colors=new Float32Array(420*3), phases=new Float32Array(420);
    let seed=42;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<420;i++) {
      positions.set([random()*2-1,random()*2-1,.8+random()*1.7],i*3);
      const light=.27+random()*.42;
      colors.set([light*.78,light*.88,light],i*3); phases[i]=random()*6.28;
    }
    stars.setAttribute('aStar',new THREE.BufferAttribute(positions,3));
    stars.setAttribute('aColor',new THREE.BufferAttribute(colors,3));
    stars.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
    stars.setDrawRange(0,420);
    this.stars = new THREE.Points(stars,raw(S.STAR_VERTEX,S.STAR_FRAGMENT,{
      uTime:uniform(0),uScale:uniform(1),uLensCenter:uniform(new THREE.Vector2()),
      uLensRadius:uniform(new THREE.Vector2(1,1)),uLensStrength:uniform(0) },
      { transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending }));
    this.stars.frustumCulled=false; this.background.add(this.stars);
  }
  createDebris() {
    const geometry=decoratedGeometry(new THREE.TetrahedronGeometry(1,0));
    const vertex=S.VERTEX.replace('precision highp float;',
      'precision highp float; in mat4 instanceMatrix; in vec3 instanceColor;')
      .replace('mat3(uModel)*aNormal','mat3(uModel*instanceMatrix)*aNormal')
      .replace('vColor=aColor','vColor=aColor*instanceColor')
      .replace('uModel*vec4(aPosition,1.0)','uModel*instanceMatrix*vec4(aPosition,1.0)')
      .replace('uMvp*vec4(aPosition,1.0)','uMvp*instanceMatrix*vec4(aPosition,1.0)');
    const material=raw(vertex,S.FRAGMENT,bodyUniforms());
    material.uniforms.uEmission.value=.28;
    this.debris=bindMatrices(new THREE.InstancedMesh(geometry,material,MAX_DEBRIS));
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for(let i=0;i<MAX_DEBRIS;i++)this.debris.setColorAt(i,white);
    this.debris.count=0; this.world.add(this.debris);
    this.debrisPose=new THREE.Object3D(); this.debrisColor=new THREE.Color();
  }
  createEffects() {
    this.effectCapacity=3*3072*9;
    this.effectArray=new Float32Array(this.effectCapacity);
    this.effectGeometry=meshGeometry(this.effectArray);
    this.effectGeometry.attributes.aPosition.data.setUsage(THREE.DynamicDrawUsage);
    this.effectGeometry.setDrawRange(0,0);
    const material=raw(S.VERTEX,S.FRAGMENT,bodyUniforms(),{
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending });
    material.uniforms.uEmission.value=1; material.uniforms.uTint.value.w=.8;
    this.effectMesh=bindMatrices(new THREE.Mesh(this.effectGeometry,material));
    this.effectsScene.add(this.effectMesh);
  }
  createGlow() {
    return bindMatrices(new THREE.Mesh(this.quad,raw(S.VERTEX,
      `precision highp float; uniform vec4 uTint; in vec3 vLocalPosition; out vec4 outColor;
       void main(){float d=length(vLocalPosition.xy);if(d>1.)discard;
       float a=exp(-d*d*6.)*(1.-smoothstep(.5,1.,d))*uTint.a;
       outColor=vec4(uTint.rgb,a);}`,bodyUniforms(),{
        transparent:true,depthWrite:false,blending:THREE.AdditiveBlending })));
  }
  updateBodies(frame) {
    const retained=new Set();
    for(const body of frame.bodies || []) {
      if(body.destroyed||body.home)continue;
      for(let index=0;index<(body.meshes||[]).length;index++) {
        const data=body.meshes[index], key=`${frame.generation}:${data.id ?? `${body.id}:${index}:${frame.revision}`}`;
        retained.add(key);
        let mesh=this.meshes.get(key);
        if(!mesh) {
          mesh=bindMatrices(new THREE.Mesh(meshGeometry(data.vertices),raw(S.VERTEX,S.FRAGMENT,bodyUniforms())));
          this.meshes.set(key,mesh); this.world.add(mesh);
        }
        setPose(mesh,body.position,body.radius,body.spin ?? body.rotation ?? 0);
        const u=mesh.material.uniforms, m=body.material||{};
        u.uPlanet.value=1; u.uHeat.value=(body.heat||0)*(frame.reducedEffects?.45:.8);
        u.uMolten.value=body.molten||0; u.uSurface.value.set(m.roughness??.94,m.metallic||0,m.incandescence||0,m.atmosphere||0);
        u.uSurfaceTime.value=frame.reducedEffects?0:frame.time%1000;
        u.uCaptureRadius.value=frame.stellar?.remnant==='BLACK_HOLE'?frame.stellar.captureRadius:0;
        let burn=null;
        for(const b of frame.burns||[])if(b.body===body.id&&(!burn||b.age<burn.age))burn=b;
        u.uBurnHeat.value=burn?Math.max(0,1-burn.age/1.1)*burn.power*(frame.reducedEffects?.4:1):0;
        if(burn)u.uBurnPoint.value.copy(vector(burn.local));
      }
    }
    for(const [key,mesh] of this.meshes)if(!retained.has(key)) {
      this.world.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();this.meshes.delete(key);
    }
  }
  updateOrbits(frame) {
    if(this.generation===frame.generation)return;
    for(const orbit of this.orbits.values()){this.world.remove(orbit);orbit.geometry.dispose();orbit.material.dispose();}
    this.orbits.clear(); this.generation=frame.generation;
    for(const body of frame.bodies||[]) {
      if(body.home)continue;
      const radius=Math.hypot(body.position.x,body.position.y), positions=new Float32Array(129*3);
      for(let i=0;i<=128;i++){const a=i/128*Math.PI*2;positions.set([Math.cos(a)*radius,Math.sin(a)*radius,-.65],i*3);}
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:body.id===2?0x203a45:0x262b3b,
        transparent:true,opacity:.48,depthWrite:false}));
      this.world.add(line);this.orbits.set(body.id,line);
    }
  }
  render(frame) {
    if(!frame)return;
    this.renderer.info.reset();
    this.updateOrbits(frame);this.updateBodies(frame);
    for(const line of this.orbits.values())line.visible=frame.stellar?.remnant!=='BLACK_HOLE';
    this.fireball.visible=!!frame.projectile;
    if(frame.projectile)setPose(this.fireball,frame.projectile,.052);
    this.debris.count=Math.min(MAX_DEBRIS,(frame.debris||[]).length);
    for(let i=0;i<this.debris.count;i++) {
      const p=frame.debris[i],m=p.material||{};
      setPose(this.debrisPose,p.position,p.size,p.rotation);this.debrisPose.updateMatrix();
      this.debris.setMatrixAt(i,this.debrisPose.matrix);
      const hot=p.solar?clamp(p.life,0,1):Math.pow(Math.max(0,((p.life||0)-.3)/.7),1.8);
      this.debrisColor.setRGB((m.r??.5)*(1-hot)+hot,(m.g??.5)*(1-hot)+hot*.38,(m.b??.6)*(1-hot)+hot*.05);
      this.debris.setColorAt(i,this.debrisColor);
    }
    this.debris.instanceMatrix.needsUpdate=true; if(this.debris.instanceColor)this.debris.instanceColor.needsUpdate=true;
    const effects=frame.effects;
    if(effects?.length) {
      if(effects.length>this.effectArray.length)throw new Error('The simulation exceeded its bounded effect stream.');
      this.effectArray.set(effects);this.effectGeometry.setDrawRange(0,effects.length/9);
      this.effectGeometry.attributes.aPosition.data.needsUpdate=true;
    } else this.effectGeometry.setDrawRange(0,0);
    const points=frame.projectileTrail||[];
    if(points.length>1) {
      let attribute=this.trail.geometry.attributes.position;
      if(!attribute||attribute.count<points.length) {
        attribute=new THREE.BufferAttribute(new Float32Array(Math.max(96,points.length)*3),3);
        attribute.setUsage(THREE.DynamicDrawUsage);this.trail.geometry.setAttribute('position',attribute);
      }
      for(let i=0;i<points.length;i++)attribute.setXYZ(i,points[i].x,points[i].y,points[i].z+.01);
      attribute.needsUpdate=true;this.trail.geometry.setDrawRange(0,points.length);this.trail.visible=true;
    } else this.trail.visible=false;
    this.glow.visible=!!frame.projectile;
    if(frame.projectile) {
      setPose(this.glow,frame.projectile,.2);this.glow.material.uniforms.uTint.value.set(1,.36,.04,.32);
    }
    const star=frame.stellar, hole=star?.remnant==='BLACK_HOLE';
    this.remnant.visible=!!star&&star.remnant!=='NONE'&&!hole;
    this.aperture.visible=!!hole;
    if(this.remnant.visible)setPose(this.remnant,{x:0,y:0,z:0},Math.max(.035,star.envelopeRadius));
    if(hole){setPose(this.aperture,{x:0,y:0,z:0},star.captureRadius*4.2);
      const u=this.aperture.material.uniforms;u.uSurfaceTime.value=frame.reducedEffects?0:frame.time%1000;
      u.uAccretion.value=Math.min(1,.18+Math.sqrt(Math.max(0,star.accretedMass))*.65);}
    const su=this.stars.material.uniforms;
    su.uTime.value=frame.reducedEffects?0:frame.time%1000;su.uScale.value=this.renderer.getPixelRatio();
    su.uLensStrength.value=hole?.75:0;
    const origin=project({x:0,y:0,z:0},this.layout);
    su.uLensCenter.value.set(origin.x/this.layout.width*2-1,1-origin.y/this.layout.height*2);
    const radius=(star?.captureRadius||.1)*this.layout.scale;
    su.uLensRadius.value.set(Math.max(.001,radius/this.layout.width*2),Math.max(.001,radius/this.layout.height*2));
    this.renderer.setRenderTarget(null);this.renderer.setScissorTest(false);this.renderer.clear(true,true,false);
    this.renderer.render(this.background,this.camera);this.renderer.render(this.world,this.camera);
    this.fluid.draw(frame,this.layout);
    this.renderer.render(this.effectsScene,this.camera);this.renderer.render(this.remnantScene,this.camera);
    if(this.shaderFailed)throw new Error('The graphics driver could not compile the game shaders.');
    const info=this.renderer.info;
    this.metrics={triangles:info.render.triangles,drawCalls:info.render.calls,
      geometries:info.memory.geometries,textures:info.memory.textures};
  }
  dispose() {
    this.fluid.dispose();
    const geometries=new Set(), materials=new Set();
    for(const scene of [this.world,this.background,this.effectsScene,this.remnantScene])scene.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      if(object.material)materials.add(object.material);
    });
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.renderer.dispose();
  }
}

class FluidSurface {
  constructor(renderer,camera) {
    this.renderer=renderer;this.camera=camera;this.size='';this.bufferSize=new THREE.Vector2();
    this.geometry=new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('aCorner',new THREE.BufferAttribute(corners,2));
    this.geometry.setDrawRange(0,6);
    for(const [name,size] of [['aCenter',3],['aRadius',1],['aHeat',1]]) {
      const a=new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLASMA*size),size);
      a.setUsage(THREE.DynamicDrawUsage);this.geometry.setAttribute(name,a);
    }
    this.geometry.instanceCount=0;
    this.particleUniforms={uViewProjection:uniform(new THREE.Matrix4()),uDepthScale:uniform(-1/48),
      uPixelWorld:uniform(new THREE.Vector2()),uRadiance:uniform(0)};
    this.densityMaterial=raw(S.PARTICLE_VERTEX,S.DENSITY_FRAGMENT,this.particleUniforms,{
      transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,
      blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendEquation:THREE.AddEquation });
    this.depthMaterial=raw(S.PARTICLE_VERTEX,S.DEPTH_FRAGMENT,this.particleUniforms);
    this.dropletMaterial=raw(S.PARTICLE_VERTEX,S.DROPLET_FRAGMENT,{
      uViewProjection:uniform(new THREE.Matrix4()),uDepthScale:uniform(-1/48),
      uPixelWorld:uniform(new THREE.Vector2()),uRadiance:uniform(1),
      uDensity:uniform(null),uDepth:uniform(null),uInvViewport:uniform(new THREE.Vector2()),
      uStellarColor:uniform(new THREE.Vector3(1,.26,.02)),uStellarBrightness:uniform(1),uHalo:uniform(.07)},
      {transparent:true,depthWrite:false,blending:THREE.NormalBlending});
    this.particleMesh=new THREE.Mesh(this.geometry,this.densityMaterial);this.particleMesh.frustumCulled=false;
    this.particleScene=new THREE.Scene();this.particleScene.add(this.particleMesh);
    const quad=new THREE.BufferGeometry();quad.setAttribute('aCorner',new THREE.BufferAttribute(corners,2));
    quad.setDrawRange(0,6);
    quad.setAttribute('aUv',new THREE.BufferAttribute(new Float32Array(corners.map(v=>v*.5+.5)),2));
    this.compositeUniforms={uDensity:uniform(null),uDepth:uniform(null),uTexel:uniform(new THREE.Vector2()),
      uGlow:uniform(1),uStrength:uniform(1),uHaloStep:uniform(new THREE.Vector2()),uHaloDepth:uniform(.75),
      uStarCenter:uniform(new THREE.Vector2()),uStarScale:uniform(new THREE.Vector2()),
      uStellarColor:uniform(new THREE.Vector3(1,.26,.02)),uStellarBrightness:uniform(1),
      uStellarPulse:uniform(0),uStellarTime:uniform(0),uStellarActivity:uniform(0)};
    this.glowMaterial=raw(S.COMPOSITE_VERTEX,S.COMPOSITE_FRAGMENT,this.compositeUniforms,{
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    this.bodyMaterial=raw(S.COMPOSITE_VERTEX,S.COMPOSITE_FRAGMENT,this.compositeUniforms);
    this.quad=new THREE.Mesh(quad,this.glowMaterial);this.quad.frustumCulled=false;
    this.compositeScene=new THREE.Scene();this.compositeScene.add(this.quad);
  }
  resize(width,height,dpr,reduced) {
    const w=Math.max(1,Math.min(384,Math.ceil(width*dpr/(reduced?6:4))));
    const h=Math.max(1,Math.min(1024,Math.ceil(height*dpr/(reduced?6:4))));
    const size=`${w}:${h}`;if(size===this.size)return;this.size=size;
    this.density?.dispose();this.depth?.dispose();
    this.density=new THREE.WebGLRenderTarget(w,h,{depthBuffer:false,stencilBuffer:false,
      minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,type:THREE.UnsignedByteType});
    this.depth=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true,stencilBuffer:false,
      minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,type:THREE.UnsignedByteType});
    this.compositeUniforms.uDensity.value=this.density.texture;this.compositeUniforms.uDepth.value=this.depth.texture;
    this.compositeUniforms.uTexel.value.set(1/w,1/h);
    this.dropletMaterial.uniforms.uDensity.value=this.density.texture;
    this.dropletMaterial.uniforms.uDepth.value=this.depth.texture;
  }
  fill(parts) {
    const attributes=this.geometry.attributes;let count=0;
    for(let i=0;i<Math.min(MAX_PLASMA,parts.length);i++) {
      const p=parts[i];if(!Number.isFinite(p.radius)||p.radius<=0)continue;
      attributes.aCenter.setXYZ(count,p.position.x,p.position.y,p.position.z);
      attributes.aRadius.setX(count,p.radius);attributes.aHeat.setX(count,clamp(p.heat,.08,1));count++;
    }
    for(const a of Object.values(attributes))if(a.isInstancedBufferAttribute)a.needsUpdate=true;
    this.geometry.instanceCount=count;return count;
  }
  draw(frame,layout) {
    const parts=frame.plasma||[];if(!parts.length)return;
    const r=this.renderer;
    this.resize(layout.width,layout.height,r.getPixelRatio(),frame.reducedEffects);
    if(!this.fill(parts))return;
    this.particleUniforms.uViewProjection.value.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    this.particleUniforms.uDepthScale.value=this.camera.projectionMatrix.elements[10]*.5;
    const vp=this.particleUniforms.uViewProjection.value.elements,d=this.dropletMaterial.uniforms;
    r.getDrawingBufferSize(this.bufferSize);
    const bufferWidth=Math.max(1,this.bufferSize.x),bufferHeight=Math.max(1,this.bufferSize.y);
    this.particleUniforms.uPixelWorld.value.set(2/(Math.abs(vp[0])*this.density.width),2/(Math.abs(vp[5])*this.density.height));
    this.particleUniforms.uRadiance.value=0;
    d.uViewProjection.value.copy(this.particleUniforms.uViewProjection.value);
    d.uDepthScale.value=this.particleUniforms.uDepthScale.value;
    d.uPixelWorld.value.set(2/(Math.abs(vp[0])*bufferWidth),2/(Math.abs(vp[5])*bufferHeight));
    d.uRadiance.value=1;d.uInvViewport.value.set(1/bufferWidth,1/bufferHeight);
    r.setClearColor(0,0);r.setRenderTarget(this.density);r.clear(true,false,false);
    this.particleMesh.material=this.densityMaterial;r.render(this.particleScene,this.camera);
    r.setRenderTarget(this.depth);r.clear(true,true,false);
    this.particleMesh.material=this.depthMaterial;r.render(this.particleScene,this.camera);
    r.setRenderTarget(null);
    const home=(frame.bodies||[]).find(b=>b.home),core=Math.max(.08,home?.radius||.4);
    const halo=clamp(core*.18,.028,.18);
    const u=this.compositeUniforms,star=frame.stellar;
    u.uHaloStep.value.set(halo*Math.abs(vp[0])*.5,halo*Math.abs(vp[5])*.5);
    u.uHaloDepth.value=clamp(vp[14]*.5+.5,0,1);
    u.uStarCenter.value.set(vp[12]*.5+.5,vp[13]*.5+.5);
    u.uStarScale.value.set(2/(core*vp[0]),2/(core*vp[5]));
    u.uStellarColor.value.copy(stellarColor(star));
    u.uStellarBrightness.value=star?.brightness==null?1:.68+.32*Math.sqrt(clamp(star.brightness,0,6));
    u.uStellarPulse.value=!star||frame.reducedEffects?0:.5+.5*star.pulse;
    u.uStellarTime.value=frame.reducedEffects?0:frame.time%1000;
    u.uStellarActivity.value=frame.reducedEffects?0:star?.phase==='COLLAPSING'?3:star?.phase==='EXPANDING'?1.8:star?.phase==='UNSTABLE'?.7:0;
    // Constrain full-screen compositing to the actual live particle support and halo.
    let minX=layout.width,maxX=0,minY=layout.height,maxY=0;
    for(const p of parts) {
      const center=project(p.position,layout),radius=(p.radius*1.9+halo)*layout.scale+8;
      minX=Math.min(minX,center.x-radius);maxX=Math.max(maxX,center.x+radius);
      minY=Math.min(minY,center.y-radius);maxY=Math.max(maxY,center.y+radius);
    }
    const x=Math.max(0,Math.floor(minX)),y=Math.max(0,Math.floor(layout.height-maxY));
    const w=Math.max(0,Math.min(layout.width,Math.ceil(maxX))-x);
    const h=Math.max(0,Math.min(layout.height,Math.ceil(layout.height-minY))-y);
    if(w&&h) {
      r.setScissor(x,y,w,h);r.setScissorTest(true);
      this.quad.material=this.glowMaterial;u.uGlow.value=frame.reducedEffects?.38:1;
      r.render(this.compositeScene,this.camera);
      this.quad.material=this.bodyMaterial;u.uGlow.value=0;r.render(this.compositeScene,this.camera);
      r.setScissorTest(false);
    }
    // Resolve sparse resident particles too; the fragment masks pixels already covered by the coherent body.
    d.uStellarColor.value.copy(stellarColor(star));
    d.uStellarBrightness.value=star?.brightness==null?1:.84+.16*Math.sqrt(clamp(star.brightness,0,6));
    let detailHalo=frame.reducedEffects?.035:.07,primaryAge=Infinity;
    if(star?.phase==='EXPANDING')detailHalo=frame.reducedEffects?.05:.11;
    else if(star?.phase==='COLLAPSING')detailHalo=frame.reducedEffects?.06:.14;
    for(const front of star?.fronts||[]) {
      if(front.depth===0&&Number.isFinite(front.age)&&front.age>=0)primaryAge=Math.min(primaryAge,front.age);
    }
    const afterglow=clamp(1-primaryAge/.8,0,1);
    d.uHalo.value=detailHalo+(frame.reducedEffects?.03:.09)*afterglow*afterglow;
    this.particleMesh.material=this.dropletMaterial;r.render(this.particleScene,this.camera);
    r.setClearColor(0x04060e,1);
  }
  dispose() {
    this.density?.dispose();this.depth?.dispose();this.geometry.dispose();this.quad.geometry.dispose();
    for(const m of [this.densityMaterial,this.depthMaterial,this.dropletMaterial,this.glowMaterial,this.bodyMaterial])m.dispose();
  }
}
