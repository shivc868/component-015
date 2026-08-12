import "./style.css";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import { CustomEase } from "gsap/CustomEase";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, Flip, CustomEase, SplitText);

/* styles are applied (style.css import above ran) — reveal the page */
document.documentElement.classList.add("app-ready");

/* Hard expo-style inOut: slow start, softer mid-speed, slow settle.
   Based on expo.inOut = cubic-bezier(0.87, 0, 0.13, 1) — pulling
   x1/x2 toward 0.5 slows the middle, toward 1/0 sharpens it. */
CustomEase.create("hardExpo", "0.82, 0, 0.18, 1");

/* ---------- Smooth scroll ---------- */

const lenis = new Lenis();
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

/* ---------- Flip the media card between sections ---------- */

/* Base duration, shared by the Flip and the snap scroll so both run
   in lockstep: same start, same duration, same curve. A fast wheel
   shortens it (see snapDurationFor) down to SNAP_DURATION_MIN. */
const SNAP_DURATION = 1.5;
const SNAP_DURATION_MIN = 0.6;

const mediaCard = document.querySelector(".media-card--hero");
const homeSlot = document.querySelector(".media-slot--home");
const awaySlot = document.querySelector(".media-slot--away");
const approachSection = document.querySelector(".approach");

let flipTween;
let revealTween;

function moveMediaTo(slot, duration = SNAP_DURATION) {
  if (slot.contains(mediaCard)) return;

  const state = Flip.getState(mediaCard);
  slot.appendChild(mediaCard);

  flipTween?.kill();
  flipTween = Flip.from(state, {
    duration,
    ease: "hardExpo",
    absolute: true,
    /* cheaper per-frame math: no nested/rotation handling needed here,
       and force3D keeps the card on the GPU for the whole flight */
    simple: true,
    force3D: true,
  });

  /* duotone -> real colour sweep while landing full-width (and back
     to duotone on the way home). power3.in keeps the duotone until
     late in the flight, then sweeps quickly — like the reference. */
  revealTween?.kill();
  revealTween = gsap.to(heroPlane.uniforms.uReveal, {
    value: slot === awaySlot && deform.colorReveal ? 1 : 0,
    duration,
    ease: "power3.in",
    onUpdate: markGLDirty,
  });
}

/* Fallback for non-wheel scrolling (scrollbar drag, keyboard) */
ScrollTrigger.create({
  trigger: ".showcase",
  start: "top 60%",
  onEnter: () => moveMediaTo(awaySlot),
  onLeaveBack: () => moveMediaTo(homeSlot),
});

/* ---------- Snap scroll between the two sections ----------
   Two stable positions: the approach section top ("home") and the
   point where the showcase image sits fully centered in the viewport
   ("away"). A wheel nudge between them drives the page to the next
   stop with the same hardExpo ease while the Flip plays in lockstep.
   Outside that zone (the spacers) scrolling stays normal Lenis smooth.
   Snap speed scales with how hard the user scrolls. */

const hardExpoEase = gsap.parseEase("hardExpo");
const EPS = 10;
let snapping = false;
/* false until the loader finishes — snap scrolling stays off */
let booted = false;

const siteHeader = document.querySelector(".site-header");

/* home/away are absolute page offsets, so they only change on layout
   changes — cache them instead of forcing layout reads on every wheel
   and scroll event (the cache clears on resize) */
let zoneCache = null;

function zonePoints() {
  if (zoneCache) return zoneCache;
  const y = lenis.scroll;
  /* home sits above the hero by the header's height, so snapping up
     lands at the page top with the header in view */
  const home =
    approachSection.getBoundingClientRect().top +
    y -
    (siteHeader?.offsetHeight ?? 0);
  const rect = awaySlot.getBoundingClientRect();
  const away = rect.top + y - (window.innerHeight - rect.height) / 2;
  zoneCache = { home, away };
  return zoneCache;
}

/* Recent wheel intensity → snap duration. A lazy nudge gets the full
   SNAP_DURATION; hard/fast scrolling compresses toward the minimum. */
let wheelHeat = 0;
let lastWheelAt = 0;

function trackWheelSpeed(event) {
  const now = performance.now();
  /* fresh gesture after a pause resets the accumulator */
  wheelHeat =
    now - lastWheelAt > 250
      ? Math.abs(event.deltaY)
      : wheelHeat + Math.abs(event.deltaY);
  lastWheelAt = now;
}

function snapDurationFor(heat) {
  return gsap.utils.clamp(
    SNAP_DURATION_MIN,
    SNAP_DURATION,
    gsap.utils.mapRange(100, 1500, SNAP_DURATION, SNAP_DURATION_MIN, heat),
  );
}

function snapTo(target, slot, duration = SNAP_DURATION) {
  snapping = true;

  /* Start the Flip on the same tick as the scroll so both animations
     begin and end together, sharing the duration and hardExpo ease */
  moveMediaTo(slot, duration);

  lenis.scrollTo(target, {
    duration,
    easing: hardExpoEase,
    lock: true,
    onComplete: () => (snapping = false),
  });
}

window.addEventListener(
  "wheel",
  (event) => {
    /* let the tuning GUI scroll without hijacking */
    if (event.target.closest?.(".lil-gui")) return;

    if (!booted) {
      event.preventDefault();
      return;
    }

    if (snapping) {
      event.preventDefault();
      return;
    }

    trackWheelSpeed(event);

    const y = lenis.scroll;
    const { home, away } = zonePoints();
    const duration = snapDurationFor(wheelHeat);

    if (event.deltaY > 0 && y >= home - EPS && y < away - EPS) {
      /* scrolling down inside the zone → land the image */
      event.preventDefault();
      snapTo(away, awaySlot, duration);
    } else if (event.deltaY < 0 && y > home + EPS && y <= away + EPS) {
      /* scrolling up inside the zone → back to the approach section */
      event.preventDefault();
      snapTo(home, homeSlot, duration);
    }
    /* everywhere else (spacers): normal Lenis smooth scrolling */
  },
  { passive: false },
);

/* Coast takeover: a hard flick from a spacer coasts into the zone
   after wheel events stop. The moment the coast crosses into the
   zone, the snap takes over mid-motion — no pause, no stoppage —
   and the faster the coast, the shorter the snap. */
function coastDurationFor(speed) {
  return gsap.utils.clamp(
    SNAP_DURATION_MIN,
    SNAP_DURATION,
    gsap.utils.mapRange(2, 40, SNAP_DURATION, SNAP_DURATION_MIN, speed),
  );
}

lenis.on("scroll", ({ scroll, velocity }) => {
  if (!booted || snapping) return;

  const { home, away } = zonePoints();
  if (scroll <= home + EPS || scroll >= away - EPS) return;

  /* still moving → keep the direction of travel; at rest → nearest */
  const speed = Math.abs(velocity);
  const goingAway = speed > 1 ? velocity > 0 : scroll - home > away - scroll;

  snapTo(
    goingAway ? away : home,
    goingAway ? awaySlot : homeSlot,
    coastDurationFor(speed),
  );
});

/* ---------- Three.js fluid media plane ----------
   The image is rendered as a WebGL plane on a transparent fixed
   canvas. Every frame the plane is synced to the DOM card's rect, so
   the Flip/snap still drive all motion — but a vertex shader bends
   the plane based on the card's on-screen velocity, giving it a
   liquid, flag-like warp in flight that springs flat on landing. */

const mediaImg = mediaCard.querySelector("img");

const glCanvas = document.createElement("canvas");
glCanvas.className = "gl-canvas";
document.body.appendChild(glCanvas);

const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas,
  alpha: true,
  /* the rounded-box SDF in the fragment shader already feathers every
     visible edge of the plane, so MSAA only costs fill rate at 2x DPR */
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x000000, 0);

/* render-on-demand: the scene only re-renders when a plane is moving
   or something GL-visible changed (uniform tween, resize, GUI edit).
   The last presented frame stays on the canvas while idle. */
let glDirty = true;
const markGLDirty = () => (glDirty = true);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 10, 4000);

function sizeGL() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  /* place the camera so 1 world unit == 1 CSS pixel at z = 0 */
  camera.position.z = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.updateProjectionMatrix();
}
sizeGL();
window.addEventListener("resize", () => {
  zoneCache = null;
  sizeGL();
  markGLDirty();
});

const VERTEX_SHADER = /* glsl */ `
    uniform vec4 uVel;
    uniform vec2 uPlaneSize;
    uniform vec2 uGrabCorner;
    uniform float uLagPower;
    uniform float uZDip;
    uniform float uBow;
    uniform float uRippleAmp;
    uniform float uRippleFreq;
    uniform float uRippleSpeed;
    uniform float uWrinkleAmp;
    uniform float uWrinkleFreq;
    uniform float uTime;
    varying vec2 vUv;
    varying float vDepth;

    void main() {
      vec3 pos = position;

      /* this vertex's own screen velocity, from the card's movement
         AND resize: the fast edge moves differently from the slow
         one, which is what shapes the reference distortion */
      vec2 vvel = vec2(
        uVel.x + uv.x * uVel.z,
        uVel.y + (1.0 - uv.y) * uVel.w
      );
      /* mean motion of the whole surface, for ripple/wrinkle drive */
      vec2 cvel = vec2(uVel.x + 0.5 * uVel.z, uVel.y + 0.5 * uVel.w);
      float velMag = length(cvel);

      /* 0 at the grab corner, 1 at the far corner: the grab corner
         stays crisp, the far corner trails the most */
      float d = distance(uv, uGrabCorner) / 1.4142135;
      float lag = pow(d, uLagPower);

      /* jelly: each vertex trails its own motion (px -> local) */
      pos.x -= vvel.x * lag / uPlaneSize.x;
      pos.y += vvel.y * lag / uPlaneSize.y;

      /* bow: edges arc perpendicular to the motion (the curved top/
         bottom edges while flying sideways in the reference) */
      pos.y += sin(uv.x * 3.141592653) * cvel.x * uBow / uPlaneSize.y;
      pos.x -= sin(uv.y * 3.141592653) * cvel.y * uBow / uPlaneSize.x;

      /* z dip: the trailing side falls away from the camera */
      pos.z -= length(vvel) * lag * uZDip;

      /* ripple: wave travelling away from the grab corner in flight */
      pos.z += sin(d * uRippleFreq * 6.2831853 - uTime * uRippleSpeed)
        * uRippleAmp * (velMag / 100.0) * d;

      /* wrinkles: fine crumple, only while the cloth is moving */
      pos.z += sin(uv.x * uWrinkleFreq * 6.2831853 + uTime * 2.0)
        * sin(uv.y * uWrinkleFreq * 4.7 + uTime * 1.3)
        * uWrinkleAmp * (velMag / 100.0);

      vDepth = pos.z;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform sampler2D uTexture;
    uniform vec2 uPlaneSize;
    uniform vec2 uImageSize;
    uniform float uRadius;
    uniform vec3 uColorDark;
    uniform vec3 uColorLight;
    uniform float uShade;
    uniform float uReveal;
    uniform float uAlpha;
    varying vec2 vUv;
    varying float vDepth;

    void main() {
      /* object-fit: cover */
      float rs = uPlaneSize.x / uPlaneSize.y;
      float ri = uImageSize.x / uImageSize.y;
      vec2 st = rs < ri
        ? vec2(uImageSize.x * uPlaneSize.y / uImageSize.y, uPlaneSize.y)
        : vec2(uPlaneSize.x, uImageSize.y * uPlaneSize.x / uImageSize.x);
      vec2 offset = (st - uPlaneSize) * 0.5;
      vec2 uv = (vUv * uPlaneSize + offset) / st;

      vec4 tex = texture2D(uTexture, uv);

      /* duotone: luminance mapped between the two accent tones */
      float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
      vec3 duotone = mix(uColorDark, uColorLight, luma);

      /* colour reveal: as the card lands full-width the real colours
         sweep in from the leading (right) side; reversed on the way
         back up. uReveal 0 = full duotone, 1 = full colour. */
      float w = smoothstep(0.1, 0.9, uReveal * 1.8 - (1.0 - vUv.x) * 0.8);
      vec3 color = mix(duotone, tex.rgb, w);

      /* depth shading: parts dipping away darken, parts rising
         toward the camera brighten — sells the cloth folds */
      float shade = clamp(vDepth * 0.004, -0.5, 0.5) * uShade;
      color *= 1.0 + shade;

      /* rounded corners via rounded-box SDF, in pixels */
      vec2 p = (vUv - 0.5) * uPlaneSize;
      vec2 b = uPlaneSize * 0.5 - vec2(uRadius);
      vec2 d = abs(p) - b;
      float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRadius;
      float alpha = 1.0 - smoothstep(-1.0, 1.0, dist);

      gl_FragColor = vec4(color, alpha * uAlpha);
    }
`;

/* ---------- Cloth plane factory ----------
   One plane per image; each syncs to its DOM element's rect and gets
   its own uniforms + velocity springs, so many cards can fly with
   the cloth warp at once (loader stack + hero). */

const clothPlanes = [];
const planeGeometry = new THREE.PlaneGeometry(1, 1, 32, 32);
const textureLoader = new THREE.TextureLoader();

function createClothPlane({
  el,
  src,
  zBase = 0,
  isActive,
  soften = 1,
  grabCorner = null,
}) {
  /* 0..1 scale on the whole deformation: 1 = full tuned cloth,
     lower = calmer, more fluid motion (used by the loader) */
  let softenValue = soften;
  /* per-plane grab corner override (loader flights pull from their
     leading edge); null falls back to the GUI's deform.corner */
  let grabCornerValue = grabCorner;
  const uniforms = {
    uTexture: { value: null },
    /* smoothed screen velocities: x=left, y=top, z=width, w=height */
    uVel: { value: new THREE.Vector4(0, 0, 0, 0) },
    uReveal: { value: 0 },
    uAlpha: { value: 1 },
    uGrabCorner: { value: new THREE.Vector2(1, 1) },
    uLagPower: { value: 1 },
    uZDip: { value: 0 },
    uBow: { value: 0 },
    uRippleAmp: { value: 0 },
    uRippleFreq: { value: 0 },
    uRippleSpeed: { value: 0 },
    uWrinkleAmp: { value: 0 },
    uWrinkleFreq: { value: 1 },
    uShade: { value: 0 },
    uTime: { value: 0 },
    uPlaneSize: { value: new THREE.Vector2(1, 1) },
    uImageSize: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 24 }, // 1.5rem, matches .media-card
    /* duotone endpoints approximating the CSS grayscale + accent wash */
    uColorDark: { value: new THREE.Color("#2b2bd5") },
    uColorLight: { value: new THREE.Color("#dfe0ff") },
  };

  const mesh = new THREE.Mesh(
    planeGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      /* stacking is decided purely by renderOrder: every plane stays
         at z=0 so it matches its DOM rect exactly (a real z offset
         would scale it up through the perspective camera) */
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    }),
  );
  mesh.visible = false;
  mesh.renderOrder = zBase;
  scene.add(mesh);

  const ready = new Promise((resolve) => {
    textureLoader.load(
      src,
      (tex) => {
        tex.minFilter = THREE.LinearFilter;
        uniforms.uTexture.value = tex;
        uniforms.uImageSize.value.set(tex.image.width, tex.image.height);
        mesh.visible = true;
        /* hand rendering over to WebGL; the DOM card keeps layout */
        el.classList.add("gl-active");
        markGLDirty();
        resolve();
      },
      undefined,
      () => resolve(), // on error the DOM <img> stays visible
    );
  });

  let lastRect = null;
  const edgeVel = [0, 0, 0, 0];
  const edgeSpr = [0, 0, 0, 0];

  function update(time) {
    const rect = el.getBoundingClientRect();

    mesh.scale.set(rect.width, rect.height, 1);
    mesh.position.set(
      rect.left + rect.width / 2 - window.innerWidth / 2,
      window.innerHeight / 2 - (rect.top + rect.height / 2),
      0,
    );
    uniforms.uPlaneSize.value.set(rect.width, rect.height);

    /* live-sync GUI params so sliders act mid-animation too,
       scaled by this plane's soften factor */
    const s = softenValue;
    uniforms.uTime.value = time;
    uniforms.uLagPower.value = deform.lagPower;
    uniforms.uZDip.value = deform.zDip * s;
    uniforms.uBow.value = deform.bow * s;
    uniforms.uRippleAmp.value = deform.rippleAmp * s;
    uniforms.uRippleFreq.value = deform.rippleFreq;
    uniforms.uRippleSpeed.value = deform.rippleSpeed;
    uniforms.uWrinkleAmp.value = deform.wrinkleAmp * s;
    uniforms.uWrinkleFreq.value = deform.wrinkleFreq;
    uniforms.uShade.value = deform.shade * s;
    uniforms.uGrabCorner.value.set(
      ...CORNERS[grabCornerValue ?? deform.corner],
    );

    /* raw per-edge velocities: movement AND resize of the card */
    if (lastRect === null) lastRect = rect;
    const raw = [
      rect.left - lastRect.left,
      rect.top - lastRect.top,
      rect.width - lastRect.width,
      rect.height - lastRect.height,
    ];
    lastRect = rect;

    /* deform only while this card is actually in motion */
    const active = isActive();
    const { intensity, maxPull, stiffness, damping } = deform;

    for (let i = 0; i < 4; i++) {
      const target = active
        ? gsap.utils.clamp(-maxPull, maxPull, raw[i] * intensity * s)
        : 0;
      edgeSpr[i] += (target - edgeVel[i]) * stiffness;
      edgeSpr[i] *= damping;
      edgeVel[i] += edgeSpr[i];
    }
    uniforms.uVel.value.set(edgeVel[0], edgeVel[1], edgeVel[2], edgeVel[3]);

    /* whole-plane 3D lean into the mean motion */
    const meanX = edgeVel[0] + 0.5 * edgeVel[2];
    const meanY = edgeVel[1] + 0.5 * edgeVel[3];
    mesh.rotation.x = meanY * deform.tilt * s * 0.002;
    mesh.rotation.y = -meanX * deform.tilt * s * 0.002;

    /* true while the card is visibly in motion: mid-tween, its rect
       moved this frame (scroll/resize), or the springs still settling.
       uTime only shows through velocity-scaled terms, so a still plane
       renders identically frame to frame and can skip the draw. */
    return (
      active ||
      raw[0] !== 0 ||
      raw[1] !== 0 ||
      raw[2] !== 0 ||
      raw[3] !== 0 ||
      Math.abs(edgeVel[0]) +
        Math.abs(edgeVel[1]) +
        Math.abs(edgeVel[2]) +
        Math.abs(edgeVel[3]) >
        0.01
    );
  }

  const plane = {
    el,
    mesh,
    uniforms,
    update,
    ready,
    get soften() {
      return softenValue;
    },
    set soften(v) {
      softenValue = v;
    },
    get grabCorner() {
      return grabCornerValue;
    },
    set grabCorner(v) {
      grabCornerValue = v;
    },
  };
  clothPlanes.push(plane);
  return plane;
}

/* hero image plane: cloth active during the Flip or a loader flight.
   Starts softened for the gentle loader motion; restored to the full
   tuned cloth once the page is handed over to scrolling. */
const heroPlane = createClothPlane({
  el: mediaCard,
  src: mediaImg.currentSrc || mediaImg.src,
  zBase: 60,
  soften: 0.35,
  isActive: () =>
    (flipTween && flipTween.isActive()) || gsap.isTweening(mediaCard),
});

/* ---------- Deformation tuning GUI ---------- */

const deform = {
  /* pull */
  intensity: 10.83, // edge velocity -> trail multiplier
  maxPull: 551, // px cap so it never folds over
  lagPower: 0.73, // corner whip curve (higher = corner leads harder)
  corner: "top-right",
  /* spring */
  stiffness: 0.085, // how fast the cloth reacts
  damping: 0.4, // lower = more jelly wobble on settle
  /* depth */
  zDip: 1.5, // trailing side falls away from camera
  bow: 0.17, // edges arc perpendicular to the motion
  tilt: 0.24, // whole-plane 3D lean with the motion
  shade: 0.38, // darken folds that dip away
  /* cloth detail */
  rippleAmp: 29, // travelling wave height (px)
  rippleFreq: 1.45, // waves across the surface
  rippleSpeed: 13.5, // how fast the wave travels
  wrinkleAmp: 0, // fine crumple height (px)
  wrinkleFreq: 15, // crumple density
  /* colour */
  colorReveal: true, // sweep to real colours on landing
};

const CORNERS = {
  "top-right": [1, 1],
  "top-left": [0, 1],
  "bottom-right": [1, 0],
  "bottom-left": [0, 0],
  center: [0.5, 0.5],
};

/* the panel only exists behind ?debug, so lil-gui is loaded on demand
   and stays out of the main bundle for regular visitors */
if (new URLSearchParams(location.search).has("debug")) {
  import("lil-gui").then(({ default: GUI }) => {
    const gui = new GUI({ title: "Deformation" });

    const fPull = gui.addFolder("Pull");
    fPull.add(deform, "intensity", 0, 30, 0.01).name("pull intensity");
    fPull.add(deform, "maxPull", 0, 1200, 1).name("max pull (px)");
    fPull.add(deform, "lagPower", 0.1, 6, 0.01).name("lag curve");
    fPull.add(deform, "corner", Object.keys(CORNERS)).name("grab corner");

    const fSpring = gui.addFolder("Spring");
    fSpring.add(deform, "stiffness", 0.005, 0.6, 0.005).name("stiffness");
    fSpring.add(deform, "damping", 0.4, 0.995, 0.005).name("damping");

    const fDepth = gui.addFolder("Depth");
    fDepth.add(deform, "zDip", 0, 5, 0.01).name("z dip");
    fDepth.add(deform, "bow", 0, 5, 0.01).name("bow");
    fDepth.add(deform, "tilt", 0, 2, 0.01).name("3d tilt");
    fDepth.add(deform, "shade", 0, 2, 0.01).name("fold shading");

    const fCloth = gui.addFolder("Cloth detail");
    fCloth.add(deform, "rippleAmp", 0, 500, 1).name("ripple amount");
    fCloth.add(deform, "rippleFreq", 0, 25, 0.05).name("ripple waves");
    fCloth.add(deform, "rippleSpeed", 0, 80, 0.1).name("ripple speed");
    fCloth.add(deform, "wrinkleAmp", 0, 400, 1).name("wrinkle amount");
    fCloth.add(deform, "wrinkleFreq", 1, 100, 0.5).name("wrinkle density");

    gui.add(deform, "colorReveal").name("colour reveal");
    gui
      .add(
        {
          copy: () => {
            const json = JSON.stringify(deform, null, 2);
            navigator.clipboard?.writeText(json).catch(() => {});
            console.log("deform config:\n" + json);
          },
        },
        "copy",
      )
      .name("copy config");
    gui.add({ reset: () => gui.reset() }, "reset").name("reset all");

    /* slider edits must show even while every plane is at rest */
    gui.onChange(markGLDirty);
  });
}

/* one ticker drives every cloth plane; the draw is skipped on frames
   where no plane moved and nothing GL-visible changed */
gsap.ticker.add((time) => {
  let needsRender = glDirty;
  glDirty = false;
  for (const p of clothPlanes) needsRender = p.update(time) || needsRender;
  if (needsRender) renderer.render(scene, camera);
});

/* ---------- Loader ----------
   A progress counter runs while 12 images fly in from the sides with
   the cloth warp and stack in the center. The top one is the hero
   image; when loading completes it Flips into the hero section and
   the hero content animates in with it. */

const loaderEl = document.querySelector(".loader");
const loaderCount = document.querySelector(".loader__count");
const loaderSlot = document.querySelector(".media-slot--loader");
const stackCards = gsap.utils.toArray(".media-card--stack");

/* Premium entrance setup: title + paragraph split into masked lines
   (each line clips inside its own overflow wrapper and rises in).
   Splitting happens now — system font stack, so no reflow risk.
   The header only fades: any movement on it reads as page scroll. */
const heroHeader = document.querySelector(".site-header");
const pillBtn = document.querySelector(".approach__content .pill-btn");
const metaEl = document.querySelector(".approach__meta");
const statEls = gsap.utils.toArray(".approach__stat");

const titleSplit = new SplitText(".approach__title", {
  type: "lines",
  mask: "lines",
});
const textSplit = new SplitText(".approach__text", {
  type: "lines",
  mask: "lines",
});

/* freeze the page AT THE TOP and stage the hero card on the stack:
   no scrolling (or restored scroll position) until the hero lands */
history.scrollRestoration = "manual";
window.scrollTo(0, 0);
lenis.scrollTo(0, { immediate: true, force: true });
lenis.stop();
document.documentElement.style.overflow = "hidden";
gsap.set(heroHeader, { opacity: 0 });
/* lines hide inside their masks; CTA and stats sit low + transparent */
gsap.set([...titleSplit.lines, ...textSplit.lines], { yPercent: 110 });
gsap.set(pillBtn, { opacity: 0, y: 24 });
gsap.set(metaEl, { opacity: 0 });
gsap.set(statEls, { opacity: 0, y: 24 });
loaderSlot.appendChild(mediaCard);
/* hero flies in from the right (odd index) → pulled by its left edge */
heroPlane.grabCorner = "top-left";
/* full original colour on the loading screen; the glide to the hero
   sweeps it back to the duotone (moveMediaTo tweens uReveal to 0) */
heroPlane.uniforms.uReveal.value = 1;

const stackPlanes = stackCards.map((card, i) =>
  createClothPlane({
    el: card,
    src: card.querySelector("img").src,
    zBase: (i + 1) * 3,
    soften: 0.35,
    /* opposite pull for opposite directions: cards from the left are
       grabbed by their right (leading) corner, and vice versa */
    grabCorner: i % 2 ? "top-left" : "top-right",
    isActive: () => gsap.isTweening(card),
  }),
);

/* stack images show their original colours, no duotone */
stackPlanes.forEach((p) => (p.uniforms.uReveal.value = 1));

/* park every flyer offscreen right away — otherwise cards whose
   texture loads early sit visible in the centre while the rest of
   the images are still downloading */
const flyers = [...stackCards, mediaCard];
flyers.forEach((el, i) => {
  const side = i % 2 ? 1 : -1;
  gsap.set(el, { x: side * window.innerWidth });
});

Promise.all(clothPlanes.map((p) => p.ready)).then(() => {
  /* mostly sequential: each image lands on top of the previous one */
  const STAGGER = 0.45;
  const FLIGHT = 0.9;

  const tl = gsap.timeline({ onComplete: finishLoader });

  flyers.forEach((el, i) => {
    const side = i % 2 ? 1 : -1;
    tl.fromTo(
      el,
      {
        x: side * (window.innerWidth / 2 + el.getBoundingClientRect().width),
      },
      { x: 0, duration: FLIGHT, ease: "hardExpo" },
      i * STAGGER,
    );
  });

  /* progress counter runs across the whole stack sequence */
  const counter = { value: 0 };
  tl.to(
    counter,
    {
      value: 100,
      duration: tl.duration(),
      ease: "none",
      onUpdate: () => {
        loaderCount.textContent = Math.round(counter.value) + "%";
      },
    },
    0,
  );
});

function finishLoader() {
  gsap.set(mediaCard, { clearProps: "x" });

  /* a short beat at 100%, then the centre image glides smoothly
     (long, gentle, still softened) from the stack into the hero */
  gsap.delayedCall(0.35, () => {
    heroPlane.soften = 0.5;
    moveMediaTo(homeSlot, 1.6);
  });

  /* loader melts away — DOM overlay and GL stack planes together */
  gsap.to(loaderEl, {
    opacity: 0,
    duration: 0.7,
    delay: 0.5,
    onComplete: () => loaderEl.remove(),
  });
  gsap.to(loaderCount, {
    opacity: 0,
    duration: 0.4,
    delay: 0.35,
    onComplete: () => loaderCount.remove(),
  });
  stackPlanes.forEach((p) => {
    gsap.to(p.uniforms.uAlpha, {
      value: 0,
      duration: 0.55,
      delay: 0.45,
      onUpdate: markGLDirty,
      onComplete: () => {
        scene.remove(p.mesh);
        clothPlanes.splice(clothPlanes.indexOf(p), 1);
        markGLDirty();
      },
    });
  });

  /* hero content rides in with the landing image on one timeline:
     masked title lines rise first, the paragraph follows, then the
     CTA and stats cascade in. The header only fades so nothing
     reads as a page scroll. */
  gsap
    .timeline({ delay: 0.65, defaults: { ease: "hardExpo" } })
    .to(heroHeader, { opacity: 1, duration: 1.1, ease: "power2.out" }, 0)
    .to(titleSplit.lines, { yPercent: 0, duration: 1.2, stagger: 0.09 }, 0)
    .to(textSplit.lines, { yPercent: 0, duration: 1.1, stagger: 0.05 }, 0.2)
    .to(pillBtn, { opacity: 1, y: 0, duration: 1 }, 0.55)
    .to(metaEl, { opacity: 1, duration: 0.9, ease: "power2.out" }, 0.65)
    .to(statEls, { opacity: 1, y: 0, duration: 1, stagger: 0.09 }, 0.7);

  /* hand the page back once the flight has landed; the full tuned
     cloth + GUI grab corner come back for the scroll-snap flights */
  gsap.delayedCall(2.1, () => {
    heroPlane.soften = 1;
    heroPlane.grabCorner = null;
    document.documentElement.style.overflow = "";
    lenis.start();
    booted = true;
  });
}
