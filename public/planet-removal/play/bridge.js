// Generated method inventory; all game algorithms remain in the original C++ files.
import createPlanetRemovalWasm from './planet-removal-native.js';
const inventory = {"PhysicsEngine":["nativeCreate","nativeDestroy","nativeVersion","nativeStep3D","nativeStep","nativeStepParticles3D","nativeStepDebris","nativeSetRemnantGravity","nativeStepParticles","nativeInitFluid","nativeRestoreFluid","nativeSyncFluidActivity","nativeSyncFluidState","nativeStepFluid","nativeFluidUpdateStats","nativeSetStellarForces","nativeBlastFluid","nativeImpulseFluid","nativeFluidCore","nativeFluidBodyCount","nativeCandidateMask","nativeResourceBytes"],"NativeEntities":["nativeVersion","nativeSetBounds","nativeSyncBodies","nativeSyncProjectile","nativeTickProjectile","nativeSpawnDebris","nativeClearDebris","nativeCopyDebris","nativeStepDebris","nativeRetireFluidOutside","nativeStats","nativeEntityId","nativeIsAlive"],"NativeDestruction":["nativeGenerate","nativeCarve","nativeTidal","nativeMaterialRemoved","nativeNearest"],"NativeMesher":["meshRegions"],"NativeAudio":["createScore","scoreScene","scoreTension","renderScore","destroyScore","synthesize","createOutput","gateOutput","configureOutput","serviceOutput","outputStats","destroyOutput"]};
export function createPlanetRemovalNative(options = {}) {
    let module;
    const api = {ready: null};
    function invoke(key, args) {
        if (!module) throw new Error('Planet Removal native runtime is not ready');
        const result = module.invokeNative(key, args);
        if (result && result.__planetError) {
            const info = result.__planetError;
            const error = new Error(info.message);
            error.name = info.type.split('/').pop();
            error.javaType = info.type;
            error.errorMask = info.mask;
            throw error;
        }
        return result;
    }
    for (const [owner, methods] of Object.entries(inventory)) {
        api[owner] = {};
        for (const method of methods) {
            const call = (...args) => invoke(owner + '.' + method, args);
            api[owner][method] = call;
            api[owner + '_' + method] = call;
        }
    }
    api.invoke = (owner, method, args) => invoke(owner + '.' + method, args);
    api.ready = createPlanetRemovalWasm(options).then(instance => {module = instance; return api;});
    globalThis.PlanetRemovalNative = api;
    return api;
}
