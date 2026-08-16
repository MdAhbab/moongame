import * as THREE from 'three'
import { registry } from '../disposal.ts'
import type { Skin } from '../../game/data/skins.ts'

const regolithMat = new THREE.MeshStandardMaterial({
  color: 0xb8b4ad,
  roughness: 0.95,
  metalness: 0.0,
})

/**
 * Procedural grain/swell intensity. Uniform, so branching on it in the shader
 * is uniform control flow and `dFdx` stays defined.
 *
 * High = both octaves, Medium = mare swell only, Low = albedo maps alone.
 */
const regolithDetail = { value: 1 }

export function setRegolithDetail(tier: 'High' | 'Medium' | 'Low'): void {
  regolithDetail.value = tier === 'High' ? 1 : tier === 'Medium' ? 0.5 : 0
}

regolithMat.onBeforeCompile = (shader) => {
  shader.uniforms['uDetail'] = regolithDetail
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vWorldPos;`
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
  )

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vWorldPos;
uniform float uDetail;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}`
  )

  // Detail is computed once, at file scope, and read by three separate chunks
  // further down `main`. It used to be evaluated twice at identical coordinates,
  // and simplex noise is not cheap enough to pay for twice.
  //
  // It is also computed *unconditionally*. `dFdx`/`dFdy` below sample the value
  // in neighbouring fragments, and derivatives taken inside non-uniform control
  // flow are undefined — so the distance blend multiplies the result rather than
  // branching around producing it.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    `#include <color_fragment>

    float gDist = length(cameraPosition - vWorldPos);
    // Two bands. The fine one is grain underfoot; the coarse one is the swell
    // and hollow of the mare, and it carries much further — the previous single
    // band faded out entirely by 150 u, which is roughly the near edge of what
    // is on screen, so everything past it was a flat grey sheet.
    float gNearBlend = 1.0 - smoothstep(30.0, 320.0, gDist);
    float gFarBlend  = 1.0 - smoothstep(1200.0, 5200.0, gDist);

    // Frequencies are chosen against the distance each band is visible at, not
    // by eye. A feature has to be several pixels across or it aliases into
    // sandpaper: at 0.35 the coarse band had a ~3 u wavelength, which subtends
    // about two pixels a kilometre away, and the horizon crawled. At 0.012 it is
    // ~80 u — the swell and hollow of a mare — and holds together to the limb.
    //
    // uDetail is a uniform, so this branch is uniform control flow: Low skips
    // both simplex evaluations, Medium keeps the cheap far swell, High pays
    // for grain underfoot. Derivatives of gHeight below stay defined.
    float gFine = 0.0;
    float gCoarse = 0.0;
    if (uDetail > 0.99) {
      gFine = snoise(vWorldPos * 1.6);
      gCoarse = snoise(vWorldPos * 0.012);
    } else if (uDetail > 0.01) {
      gCoarse = snoise(vWorldPos * 0.012);
    }

    // Unitless, for tinting.
    float gDetail = gFine * gNearBlend + gCoarse * 0.85 * gFarBlend;

    // In world units, for the bump below — and they are not interchangeable.
    //
    // Feeding the unitless value straight into a derivative bump was wrong by
    // orders of magnitude: it asks for a bump one *unit* tall across a feature
    // 0.6 units wide, which is a ten-to-one slope, and the regolith came out
    // covered in hard lumps. Amplitude has to be a small fraction of the
    // wavelength of the band it belongs to, so each band carries its own:
    // ~12% of 0.6 u for the grain, ~8% of 83 u for the swell.
    float gHeight = gFine * 0.075 * gNearBlend + gCoarse * 6.5 * gFarBlend;

    diffuseColor.rgb *= (1.0 + gDetail * 0.14);
    `
  )

  // `roughness_fragment` is not a three.js chunk. The chunk is
  // `roughnessmap_fragment`, so the previous replace matched nothing and the
  // roughness variation silently never applied — a shader edit that compiles
  // clean, ships, and does exactly nothing.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    `#include <roughnessmap_fragment>
    roughnessFactor = clamp(roughnessFactor + gDetail * 0.22, 0.0, 1.0);
    `
  )

  // The reason the surface read flat.
  //
  // Perturbing albedo and roughness changes what the ground *is* without
  // changing how light falls across it, and at a grazing sun angle over
  // near-white regolith that is almost invisible. Relief needs the normal.
  //
  // Mikkelsen's derivative bump: reconstruct the surface gradient of the height
  // field from screen-space derivatives, with no tangent frame and no UVs —
  // which is the only practical option on a sphere this size.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>
    {
      vec3 dPdx = dFdx(vWorldPos);
      vec3 dPdy = dFdy(vWorldPos);
      float dHdx = dFdx(gHeight);
      float dHdy = dFdy(gHeight);

      vec3 r1 = cross(dPdy, normal);
      vec3 r2 = cross(normal, dPdx);
      float det = dot(dPdx, r1);
      // The determinant is zero on a degenerate triangle and at silhouettes;
      // guarding it is the difference between relief and a screen full of NaN.
      // No strength multiplier: gHeight already carries the amplitude, in world
      // units. A multiplier here would be a second, unitless scale fighting the
      // first, which is exactly how the previous version ended up at seven.
      vec3 grad = (r1 * dHdx + r2 * dHdy) / max(abs(det), 1e-7);
      normal = normalize(normal - grad);
    }
    `
  )
}

export const Materials = {
  regolith: registry.trackPermanent(regolithMat),
  /**
   * The player's hull.
   *
   * `roughness: 0.35, metalness: 0.6` is the uncanny middle: too rough to mirror
   * the environment map, too metallic to hold a diffuse shade, so the model
   * arrived as flat pale plastic — most of why the craft read as a toy. Real
   * spacecraft skin is either near-mirror foil or matte thermal blanket, and the
   * eye reads *either* as manufactured. This is the polished-alloy end: rough
   * enough to hold a broad highlight along the spine, metallic enough that the
   * HDRI does the describing, with a faint envMap boost so the unlit side picks
   * up earthshine instead of going black.
   */
  craftHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0xd7dfe8,
      roughness: 0.22,
      metalness: 0.94,
      envMapIntensity: 1.35,
    })
  ),
  /** Panels, intakes and the anti-glare nose: matte, to contrast the alloy. */
  craftTrim: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x11161d,
      roughness: 0.82,
      metalness: 0.15,
    })
  ),
  /**
   * Hostile hulls — one per archetype, separated in **value** as well as hue.
   *
   * All three used to share a single material: a near-black diffuse under
   * `emissive: 0xff8a3d` at intensity 1.1. Emissive is not lit, so almost the
   * whole pixel arrived unshaded and every hostile rendered as a flat orange
   * cut-out with no surface, no depth and no readable form — the shape was
   * there and none of the cues that make a shape look solid were.
   *
   * The three are ordered light → dark (ochre, gunmetal, burnt red) so they
   * stay distinguishable in greyscale, which §35.1 requires: colour is the
   * second channel, never the first. Each keeps a small emissive of its own
   * hue so a hostile on the unlit side of the moon is still a hostile rather
   * than a hole, but at a tenth of the old strength, low enough that the
   * lighting rig does the describing.
   */
  harvesterHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x8a6a3c,
      emissive: 0x3a2a12,
      emissiveIntensity: 0.5,
      roughness: 0.78,
      metalness: 0.3,
    })
  ),
  interceptorHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x5c2a1c,
      emissive: 0x3a1008,
      emissiveIntensity: 0.5,
      roughness: 0.34,
      metalness: 0.66,
    })
  ),
  sentinelHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x4a4f57,
      emissive: 0x1b2026,
      emissiveIntensity: 0.5,
      roughness: 0.48,
      metalness: 0.82,
    })
  ),
  /**
   * The late archetypes (§7.3), continuing the same light → dark ordering so
   * all six stay separable in greyscale.
   *
   * The Sapper is the brightest hull in the game and the smallest object in it,
   * which is not a contradiction: it is a deadline, and a deadline the player
   * fails to *see* is a deadline that is simply unfair. The Warden is the
   * coldest and most metallic, so the field it projects reads as equipment
   * rather than as an aura. The Carrier is the darkest and roughest — an
   * industrial hull, the biggest silhouette in the sky, and deliberately the
   * least glamorous thing in it.
   */
  sapperHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0xd8a24a,
      emissive: 0x6a3c08,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.5,
    })
  ),
  wardenHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x6d7580,
      emissive: 0x1a2530,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.9,
    })
  ),
  carrierHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x38343a,
      emissive: 0x140f16,
      emissiveIntensity: 0.45,
      roughness: 0.86,
      metalness: 0.42,
    })
  ),
  /**
   * A Warden's suppression field.
   *
   * Additive, back-side, and depth-writeless, so it reads as a volume the player
   * is looking *into* rather than as a bubble sitting in front of things. The
   * opacity is deliberately low: it has to make the boundary unmistakable
   * without hiding the hostiles inside it, since knowing what is being protected
   * is half the information it carries.
   */
  wardenField: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0x6fd0ff,
      transparent: true,
      opacity: 0.075,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  ),
  /**
   * The lit parts of a hostile: intake mouths, engine nozzles, the Sentinel's
   * shield posts. Unlit on purpose — these are supposed to be light sources,
   * so they stay legible against the moon's day side and read as the same
   * faction across all six archetypes.
   */
  enemyGlow: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xffa24a,
    })
  ),
  /**
   * Incoming fire — unlit, like the player's tracer and for the same reason: a
   * shot you are expected to dodge must not be allowed to fall into shadow.
   *
   * Previously this was the hostile *hull* material, a lit `MeshStandard` whose
   * heavy emissive happened to keep the quads visible. It worked by accident,
   * and it tied the colour of every incoming round to the colour of enemy
   * paint. Hotter and redder than `enemyGlow` on purpose: engine light is
   * scenery, this is the thing that hurts.
   */
  enemyProjectile: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xff6a2a,
    })
  ),
  outpostShell: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x9aa3ad,
      roughness: 0.25,
      metalness: 0.8,
    })
  ),
  beacon: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x7fe8ff,
      emissive: 0x7fe8ff,
      emissiveIntensity: 2.0,
    })
  ),
  /**
   * Tracers, and why they are additive.
   *
   * A tracer is *light*, not a painted object: a hot round leaving a barrel is
   * seen because it emits, and additive blending is the only thing that reads
   * that way against black sky and pale regolith alike. Flat unlit cyan on an
   * opaque quad is a sprite from 1998, which is most of why the shooting looked
   * like a toy.
   */
  projectile: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xbdf3ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  ),
  enemyTracer: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xffb070,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  ),
  /** The missile's body: a lit, metallic object, unlike its flame. */
  missile: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0xb9c2cc,
      roughness: 0.42,
      metalness: 0.85,
    })
  ),
  /** Rocket and drone exhaust — emissive so it survives the unlit hemisphere. */
  thrustFlame: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xffc061,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  ),
  /** Escort drone hull. Reads as *yours*: the friendly cyan, lit not emissive. */
  droneHull: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x9fb4c6,
      roughness: 0.34,
      metalness: 0.8,
      emissive: 0x12303c,
      emissiveIntensity: 0.35,
    })
  ),
  /**
   * The bomb casing: dark, matte, heavy.
   *
   * It was a black body under `emissive: 0xff3b00` at 1.6, which drowned the
   * shading and left a glowing orange lozenge — the payload looked like a
   * powerup. A bomb should read as *mass*: unlit metal, with the heat confined
   * to the tail flare, so the eye reads weight and the trajectory reads as a
   * fall rather than a float.
   */
  bomb: registry.trackPermanent(
    new THREE.MeshStandardMaterial({
      color: 0x2b2f36,
      roughness: 0.62,
      metalness: 0.7,
      emissive: 0x2a0f04,
      emissiveIntensity: 0.35,
    })
  ),
  particle: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  ),
  exhaust: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0x7fe8ff,
      transparent: true,
      opacity: 0.85,
    })
  ),
  muzzle: registry.trackPermanent(
    new THREE.MeshBasicMaterial({
      color: 0xdff6ff,
      transparent: true,
      opacity: 0.9,
    })
  ),
}

/**
 * Repaints the craft in the selected livery (`game/data/skins.ts`).
 *
 * Mutates the shared materials in place rather than cloning per skin, and that
 * is safe here for a specific reason worth stating: `craftHull`, `craftTrim`
 * and `exhaust` are each bound to exactly one mesh in the whole scene — the
 * player's craft. The hostile hulls, by contrast, are each bound to an
 * instanced mesh carrying up to 48 entities, so if a skin ever reaches enemy
 * colours this function must clone instead. In-place mutation also means no material is created or
 * disposed when the player changes skins, so §36's disposal ledger stays
 * balanced without doing anything.
 *
 * Cheap enough to call on every Hangar selection: three `Color.setHex` calls.
 */
export function applySkin(skin: Skin): void {
  Materials.craftHull.color.setHex(skin.hull)
  Materials.craftTrim.color.setHex(skin.trim)
  Materials.exhaust.color.setHex(skin.emissive)
  Materials.muzzle.color.setHex(skin.emissive)
}
