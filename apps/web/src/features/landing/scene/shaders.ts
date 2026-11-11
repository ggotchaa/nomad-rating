// GLSL for the hologram look: particles that morph between shapes, and a hologram surface
// (fresnel rim + moving scanlines + glitch slices) for the paddle and the ball.

export const particleVertex = /* glsl */ `
  attribute vec3 aPos0;
  attribute vec3 aPos1;
  attribute vec3 aPos2;
  attribute vec3 aPos3;
  attribute vec4 aRand;
  attribute float aGroup;

  uniform float uTime;
  uniform float uShape;
  uniform mat4 uPaddleMatrix;
  uniform float uPixelRatio;
  uniform float uSize;
  uniform float uHiCall;
  uniform float uHiBook;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Each particle morphs with its own small delay (only while morphing, so a shape at rest is crisp).
    float travel = sin(fract(uShape) * 3.14159);
    float s = clamp(uShape + (aRand.x - 0.5) * 0.6 * travel, 0.0, 3.0);
    float w0 = smoothstep(0.0, 1.0, clamp(1.0 - abs(s - 0.0), 0.0, 1.0));
    float w1 = smoothstep(0.0, 1.0, clamp(1.0 - abs(s - 1.0), 0.0, 1.0));
    float w2 = smoothstep(0.0, 1.0, clamp(1.0 - abs(s - 2.0), 0.0, 1.0));
    float w3 = smoothstep(0.0, 1.0, clamp(1.0 - abs(s - 3.0), 0.0, 1.0));
    float wsum = max(w0 + w1 + w2 + w3, 1e-4);
    w0 /= wsum; w1 /= wsum; w2 /= wsum; w3 /= wsum;

    vec3 p0 = (uPaddleMatrix * vec4(aPos0, 1.0)).xyz;
    vec3 pos = p0 * w0 + aPos1 * w1 + aPos2 * w2 + aPos3 * w3;

    // Between two shapes the swarm swirls (strongest half-way).
    float between = 1.0 - max(max(w0, w1), max(w2, w3));
    float t = uTime * 0.6 + aRand.y * 6.2831;
    vec3 swirl = vec3(
      sin(t + pos.y * 1.7) + sin(t * 0.7 + aRand.z * 9.0),
      cos(t * 0.9 + pos.x * 1.3),
      sin(t * 1.1 + pos.x * 0.9 + aRand.w * 7.0)
    );
    pos += swirl * between * 1.6;


    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = uSize * (0.45 + aRand.y * 0.9) * (1.0 + between * 0.8);
    // Never below 2 px: sub-pixel points twinkle as they move.
    gl_PointSize = max(size * uPixelRatio / -mv.z, 2.0);

    // Colour: cyan swarm, a few violet sparks; hall tables light up for a call / bookings.
    float isCall = step(4.5, aGroup) * step(aGroup, 5.5); // table 5
    float isBooked = (1.0 - step(0.5, mod(aGroup, 2.0))) * step(0.5, aGroup); // tables 2, 4, 6
    float hi = w3 * (uHiCall * isCall + uHiBook * isBooked);
    vec3 color = mix(uColorA, uColorC, step(0.9, aRand.z) * 0.85);
    color = mix(color, uColorB, clamp(hi, 0.0, 1.0));
    // The rubber face of the paddle glows red.
    color = mix(color, uColorB, w0 * step(0.0, aPos0.z) * step(-0.3, aPos0.y) * 0.55);
    vColor = color;

    // The paddle shape packs every particle onto a small surface: keep it from saturating.
    vAlpha = (0.75 + 0.25 * aRand.w) * uOpacity * (0.32 + hi * 0.7 + between * 0.25) * (1.0 - w0 * 0.85);
  }
`

export const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.4);
    gl_FragColor = vec4(vColor * (0.55 + glow * 0.9), core * vAlpha);
  }
`

export const holoVertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vWorld;
  varying vec3 vLocal;

  void main() {
    vec3 p = position;
    vLocal = position;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`

export const holoFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uScanDensity;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vWorld;
  varying vec3 vLocal;

  void main() {
    vec3 n = normalize(vNormalV + vec3(0.0, 0.0, 1e-6));
    if (!gl_FrontFacing) n = -n;
    // Rim light. |dot| can round to slightly above 1 when a face looks straight at the camera:
    // pow() of a negative number is NaN, and the bloom pass smears one NaN pixel over the whole
    // frame (= a black frame, «blinking»). Clamp before pow.
    float facing = clamp(abs(dot(n, normalize(-vViewPos))), 0.0, 1.0);
    float fres = min(pow(1.0 - facing, 2.2), 0.75);
    // Scanlines fixed to the object (they move with it instead of crawling across it) and
    // faded out where they get thinner than a pixel, so they never shimmer.
    float phase = vLocal.y * uScanDensity;
    float aa = clamp(1.0 - fwidth(phase) * 0.35, 0.0, 1.0);
    float scan = (0.5 + 0.5 * sin(phase)) * aa;
    float intensity = 0.1 + fres * 1.0 + scan * 0.12;
    float alpha = (0.05 + fres * 0.55 + scan * 0.05) * uOpacity;
    gl_FragColor = vec4(max(uColor * intensity, 0.0), clamp(alpha, 0.0, 1.0));
  }
`

export const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    // Projector beam: bright at the emitter, fading upwards, with drifting streaks.
    float fade = pow(1.0 - vUv.y, 1.6);
    float streaks = 0.75 + 0.25 * sin(vUv.x * 80.0 + uTime * 0.3) * sin(vUv.x * 23.0);
    float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    gl_FragColor = vec4(uColor, pow(fade, 1.4) * streaks * uOpacity * 0.12 * (0.5 + edge * 0.5));
  }
`
