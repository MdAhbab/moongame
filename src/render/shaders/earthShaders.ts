export const planetVertexShader = `
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vUv = uv;
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const planetFragmentShader = `
uniform sampler2D tSurface;
uniform vec3 uSunDir;
uniform vec3 uCityLightColor;
uniform float uHasAtmosphere; // 1.0 for true, 0.0 for false

// Ring shadow uniforms
uniform float uHasRings;
uniform vec3 uRingNormal;
uniform float uRingInnerRadius;
uniform float uRingOuterRadius;
uniform vec3 uPlanetPos;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vec4 surfaceColor = texture2D(tSurface, vUv);
  
  vec3 normal = normalize(vNormal);
  vec3 sunDir = normalize(uSunDir);
  
  float ndotl = dot(normal, sunDir);
  
  // Terminator softness
  // Airless body: knife-edge. Atmosphere: soft gradient.
  float softness = mix(0.01, 0.25, uHasAtmosphere);
  float lit = smoothstep(-softness, softness, ndotl);
  
  // Ring shadow on the planet
  float shadow = 1.0;
  if (uHasRings > 0.5) {
    vec3 toPixel = vWorldPosition - uPlanetPos;
    float denom = dot(sunDir, uRingNormal);
    if (abs(denom) > 1e-4) {
      float t = dot(toPixel, uRingNormal) / denom;
      if (t > 0.0) {
        vec3 intersect = toPixel - t * sunDir;
        float dist = length(intersect);
        if (dist >= uRingInnerRadius && dist <= uRingOuterRadius) {
          // Soft ring shadow
          float edgeSoft = 0.08 * uRingInnerRadius;
          float shadowAlpha = smoothstep(uRingInnerRadius, uRingInnerRadius + edgeSoft, dist) *
                              (1.0 - smoothstep(uRingOuterRadius - edgeSoft, uRingOuterRadius, dist));
          shadow = mix(1.0, 0.15, shadowAlpha * 0.95);
        }
      }
    }
  }

  // City lights
  // City lights appear on the night side (ndotl < 0) and fade in through the terminator.
  float isLand = smoothstep(0.4, 0.6, surfaceColor.r); 
  float nightMix = smoothstep(0.1, -0.2, ndotl);
  float cityPattern = (sin(vUv.x * 200.0) * sin(vUv.y * 100.0)) * 0.5 + 0.5;
  cityPattern *= (sin(vUv.x * 50.0 + vUv.y * 150.0) * 0.5 + 0.5);
  float lights = isLand * nightMix * smoothstep(0.5, 0.8, cityPattern) * uHasAtmosphere;
  
  vec3 finalColor = surfaceColor.rgb * (lit * 0.95 + 0.05) * shadow * 1.5; // Apply ring shadow to the lit surface
  finalColor += uCityLightColor * lights * shadow * 2.0; // Apply shadow to city lights too
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const atmosphereVertexShader = `
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const atmosphereFragmentShader = `
uniform vec3 uRimColor;
uniform vec3 uSunDir;

varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  vec3 sunDir = normalize(uSunDir);
  
  // Brightest on sunlit limb, fading around terminator
  float vdotn = max(dot(viewDir, normal), 0.0);
  
  // Rim effect: peak at glancing edge, transparent at center
  float rim = pow(clamp(1.0 - vdotn, 0.0, 1.0), 3.2);
  
  // Fade around terminator
  float ndotl = dot(normal, sunDir);
  float terminatorFade = smoothstep(-0.25, 0.25, ndotl);
  
  // Rayleigh + Mie approximation (forward scattering towards sun)
  float phase = max(0.0, dot(viewDir, sunDir));
  float mie = pow(phase, 4.0) * 0.5;
  
  float intensity = rim * terminatorFade * (0.6 + mie);
  
  gl_FragColor = vec4(uRimColor, intensity);
}
`;

export const ringVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const ringFragmentShader = `
uniform vec3 uRingColor;
uniform vec3 uSunDir;
uniform vec3 uPlanetPos;
uniform float uPlanetRadius;

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  // Radial banded alpha
  // vUv.y goes from 0 at inner radius to 1 at outer radius for RingGeometry
  float d = vUv.y;
  
  // Fake bands
  float bands = sin(d * 40.0) * 0.5 + 0.5;
  bands *= sin(d * 100.0) * 0.5 + 0.5;
  bands = smoothstep(0.2, 0.8, bands);
  
  float alpha = bands * 0.6;
  
  // Planet shadow
  vec3 toPixel = vWorldPosition - uPlanetPos;
  vec3 sunDir = normalize(uSunDir);
  
  // Distance along sun ray
  float t = dot(toPixel, sunDir);
  
  float shadow = 1.0;
  if (t > 0.0) { // pixel is behind planet relative to sun
    vec3 proj = toPixel - t * sunDir;
    float distSq = dot(proj, proj);
    if (distSq < uPlanetRadius * uPlanetRadius) {
      // In shadow
      shadow = 0.05; // slight ambient
    } else {
      // Soft penumbra
      float penumbra = smoothstep(uPlanetRadius, uPlanetRadius * 1.2, sqrt(distSq));
      shadow = mix(0.05, 1.0, penumbra);
    }
  }
  
  gl_FragColor = vec4(uRingColor * shadow, alpha);
}
`;
