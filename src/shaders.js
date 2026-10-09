// Independent WebGL implementations of the effects at https://lab.alembic.space/.
// Keep the order: text → Ink Bleed → Emerald Tablet.
// Material settings follow the lab; background grain and strength are softened.
// Both effects are static.
export const INK_BLEED = {
  bleedRadius: 2,
  threshold: 0.3,
  crispness: 0.02,
  edgeNoise: 0.53,
  noiseScale: 11.5,
  wobble: 0.08,
  grainIntensity: 0.39,
  paperGrain: 0.06,
  grainScale: 4,
  invertSource: 0,
  useOriginalColors: 0,
  paperColor: [239 / 255, 238 / 255, 234 / 255],
  inkColor: [0, 0, 0],
}

export const EMERALD_TABLET = {
  scale: 200,
  carvingDepth: 0.8,
  viscosity: 0.1,
  clarity: 1,
  glyph: 0.5,
  radiance: 0.7,
  surfaceRoughness: 0.3,
  inscriptionSharpness: 0.8,
  emeraldStrength: 0.7,
  backgroundStrength: 0.15,
}

export const VERTEX_SHADER = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

export const INK_FRAGMENT = `
  precision highp float;
  uniform sampler2D source;
  uniform vec2 size;
  uniform float bleedRadius, threshold, crispness, edgeNoise, noiseScale;
  uniform float wobble, grainIntensity, paperGrain, grainScale, invertSource, useOriginalColors;
  uniform vec3 paperColor, inkColor;

  // Value noise interpolates random values on a grid to create paper fibers.
  float randomAt(vec2 point) {
    vec3 seed = fract(vec3(point.xyx) * 0.1031);
    seed += dot(seed, seed.yzx + 33.33);
    return fract((seed.x + seed.y) * seed.z);
  }

  float noiseAt(vec2 point) {
    vec2 cell = floor(point);
    vec2 blend = fract(point);
    blend = blend * blend * (3.0 - 2.0 * blend);
    float lower = mix(randomAt(cell), randomAt(cell + vec2(1, 0)), blend.x);
    float upper = mix(randomAt(cell + vec2(0, 1)), randomAt(cell + vec2(1, 1)), blend.x);
    return mix(lower, upper, blend.y);
  }

  float fibers(vec2 point) {
    float result = 0.0;
    float weight = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      result += noiseAt(point) * weight;
      point *= 2.03;
      weight *= 0.5;
    }
    return result;
  }

  float inkAt(vec2 uv) {
    vec3 color = texture2D(source, clamp(uv, 0.0, 1.0)).rgb;
    float light = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(1.0 - light, light, step(0.5, invertSource));
  }

  void main() {
    vec2 point = gl_FragCoord.xy;
    vec2 uv = point / size;
    vec2 fiberPoint = point * noiseScale / max(size.x, size.y);
    vec2 displacement = vec2(
      fibers(fiberPoint + vec2(0.0, 17.3)),
      fibers(fiberPoint + vec2(41.7, 0.0))
    ) - 0.5;
    uv += displacement * (40.0 * wobble) / size;

    // Three rings of eight weighted samples soften the input before thresholding.
    float coverage = inkAt(uv);
    float totalWeight = 1.0;
    for (int ring = 1; ring < 4; ring++) {
      float distance = float(ring);
      float weight = exp(-2.0 * distance * distance / 9.0);
      float radius = bleedRadius * distance / 3.0;
      for (int sampleIndex = 0; sampleIndex < 8; sampleIndex++) {
        float angle = (float(sampleIndex) + distance * 0.5) * 0.7853981634;
        vec2 offset = vec2(cos(angle), sin(angle)) * radius / size;
        coverage += inkAt(uv + offset) * weight;
        totalWeight += weight;
      }
    }

    float boundary = threshold + edgeNoise * (fibers(fiberPoint * 2.0 + vec2(7.1, 3.9)) - 0.5);
    float softness = max(crispness, 0.001);
    float deposit = smoothstep(boundary - softness, boundary + softness, coverage / totalWeight);
    float grain = noiseAt(point * grainScale) - 0.5;
    float grainStrength = mix(paperGrain, grainIntensity, smoothstep(0.1, 0.9, deposit));
    deposit = clamp(deposit + grain * grainStrength, 0.0, 1.0);
    vec3 pigment = mix(inkColor, texture2D(source, clamp(uv, 0.0, 1.0)).rgb, step(0.5, useOriginalColors));
    vec3 paper = mix(paperColor, pigment, deposit);
    paper += vec3(grain * grainStrength * 0.35);
    gl_FragColor = vec4(clamp(paper, 0.0, 1.0), 1.0);
  }
`

export const EMERALD_FRAGMENT = `
  #ifdef GL_OES_standard_derivatives
  #extension GL_OES_standard_derivatives : enable
  #endif
  precision highp float;
  uniform sampler2D source;
  uniform sampler2D marbleLUT;
  uniform vec2 size;
  uniform float scale, carvingDepth, viscosity, clarity, glyph;
  uniform float radiance, surfaceRoughness, inscriptionSharpness, emeraldStrength, backgroundStrength;

  float randomAt(vec2 point) {
    vec3 seed = fract(vec3(point.xyx) * 0.1031);
    seed += dot(seed, seed.yzx + 33.33);
    return fract((seed.x + seed.y) * seed.z);
  }

  float noiseAt(vec2 point) {
    vec2 cell = floor(point);
    vec2 blend = fract(point);
    blend = blend * blend * (3.0 - 2.0 * blend);
    return mix(
      mix(randomAt(cell), randomAt(cell + vec2(1, 0)), blend.x),
      mix(randomAt(cell + vec2(0, 1)), randomAt(cell + vec2(1, 1)), blend.x),
      blend.y
    );
  }

  // Match the reference's light marble lookup rather than full-range sine noise.
  float marbleAt(vec2 point) {
    vec2 mirrored = abs(fract(point * 0.3) * 2.0 - 1.0);
    return texture2D(marbleLUT, mirrored).r;
  }

  float stoneAt(vec2 point, float seed) {
    float height = 0.0;
    float weight = 0.5;
    for (int octave = 0; octave < 6; octave++) {
      height += marbleAt(point + seed) * weight;
      float angle = height * 0.35;
      float sine = sin(angle), cosine = cos(angle);
      point = mat2(cosine, -sine, sine, cosine) * point * 2.0 + 10.0;
      weight *= 0.48;
    }
    return height;
  }

  float surfaceGrain(vec2 point) {
    float grain = 0.0;
    float weight = 0.5;
    for (int octave = 0; octave < 3; octave++) {
      grain += weight * noiseAt(point);
      point *= 2.3;
      weight *= 0.5;
    }
    return grain;
  }

  float glyphAt(vec2 point) {
    vec2 grid = point * 12.0;
    grid.x += sin(grid.y * 0.5) * 0.3;
    vec2 cell = floor(grid);
    vec2 local = abs(fract(grid) - 0.5);
    float rectangle = (1.0 - smoothstep(0.35, 0.4, local.x))
      * (1.0 - smoothstep(0.25, 0.3, local.y));
    return rectangle * step(0.6, randomAt(cell)) * 0.15
      * (0.5 + 0.5 * sin(cell.x + cell.y * 13.0));
  }

  float lightAt(vec2 uv) {
    return dot(texture2D(source, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 overlay(vec3 paper, vec3 stone) {
    vec3 dark = 2.0 * paper * stone;
    vec3 light = 1.0 - 2.0 * (1.0 - paper) * (1.0 - stone);
    return mix(dark, light, step(vec3(0.5), paper));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / size;
    vec3 paper = texture2D(source, uv).rgb;
    float luminance = dot(paper, vec3(0.2126, 0.7152, 0.0722));
    vec2 point = uv * vec2(size.x / size.y, 1.0) * scale * 0.01;
    float veins = stoneAt(point, 123.456);
    vec2 surfacePoint = point + veins * 0.35;
    float height = stoneAt(surfacePoint, 133.456);
    vec2 slope = vec2(
      stoneAt(point + veins - vec2(0.005, 0.0), 133.456) - height,
      stoneAt(point + veins - vec2(0.0, 0.005), 133.456) - height
    );
    vec3 normal = normalize(vec3(slope, max(viscosity, 0.001)));
    float fresnel = pow(1.0 - max(normal.z, 0.0), 2.8);
    float carvedHeight = mix(-carvingDepth, 0.3, luminance);

    const vec3 abyss = vec3(0.01, 0.04, 0.02);
    const vec3 deep = vec3(0.0, 0.18, 0.08);
    const vec3 core = vec3(0.05, 0.45, 0.22);
    const vec3 bright = vec3(0.2, 0.8, 0.4);
    const vec3 glow = vec3(0.6, 1.0, 0.7);

    vec3 emerald = mix(abyss, deep, (height + carvedHeight) * 0.5 + fresnel * 0.3);
    emerald = mix(emerald, core, (height + carvedHeight * 0.5) * clarity);
    emerald = mix(emerald, bright, fresnel * clarity * 0.6);
    emerald *= 1.0 + paper * (20.3 * carvedHeight * 0.4);
    float innerGlow = height + carvedHeight * 0.5;
    emerald += innerGlow * innerGlow * radiance * core * 0.8;
    emerald += glyphAt(point + veins * 0.1) * glyph * glow * 0.4;

    // Use the reference's screen derivatives, with a compatibility fallback.
    #ifdef GL_OES_standard_derivatives
    vec2 edge = vec2(dFdx(luminance), dFdy(luminance)) * size;
    #else
    vec2 edge = vec2(
      lightAt(uv + vec2(1.0 / size.x, 0.0)) - luminance,
      lightAt(uv + vec2(0.0, 1.0 / size.y)) - luminance
    ) * size;
    #endif
    float inscription = smoothstep(0.0, max(inscriptionSharpness, 0.001), length(edge));
    emerald += inscription * bright * 0.3 * inscriptionSharpness;
    float highlight = pow(max(dot(normal, vec3(0.2, 0.4, 1.0)), 0.0), 96.0);
    emerald += highlight * glow * 1.5 * clarity;
    emerald *= 0.9 + surfaceGrain(point * 4.0) * surfaceRoughness * 0.2;
    float caustic = marbleAt(point * 4.0 + 123.456);
    emerald += caustic * caustic * caustic * 0.15 * radiance * bright;

    float lettering = 1.0 - smoothstep(0.12, 0.8, luminance);
    float strength = emeraldStrength * mix(backgroundStrength, 1.0, lettering);
    gl_FragColor = vec4(mix(paper, overlay(paper, clamp(emerald, 0.0, 1.0)), strength), 1.0);
  }
`
