/** Shared Java gameplay and the real C++ native systems. Serve beside bridge.js and game-core.js. */
let bootstrap;
export async function createPlanetRemovalRuntime(options = {}) {
  const notify = (progress, message) => options.onProgress?.({progress, message});
  if (!bootstrap) bootstrap = (async () => {
    notify(0.1, 'Loading native physics, destruction, meshing, and audio');
    if (!globalThis.PlanetRemovalNative) {
      const {createPlanetRemovalNative} = await import('./bridge.js');
      createPlanetRemovalNative();
    }
    await globalThis.PlanetRemovalNative.ready;
    notify(0.6, 'Loading the shared Java game rules');
    const {boot} = await import('./game-core.js');
    boot([]);
  })().catch(error => { bootstrap = undefined; throw error; });
  await bootstrap;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  const runtime = globalThis.__PlanetRemovalJavaCreate({...options, storage});
  // Java longs remain exact decimal strings. Accept either strings or snapshot values.
  const ack = runtime.ack.bind(runtime);
  runtime.ack = (generation, revision) => ack(String(generation), String(revision));
  const resize = runtime.resize.bind(runtime);
  runtime.resize = (width, height, top = 0, bottom, density = 1) => {
    if (bottom === undefined) resize(width, height, 0, 0, top || 1);
    else resize(width, height, top, bottom, density);
  };
  return runtime;
}
