import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, Flip, CustomEase);

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
const SNAP_DURATION_MIN = 0.2;

const mediaCard = document.querySelector(".media-card");
const homeSlot = document.querySelector(".media-slot--home");
const awaySlot = document.querySelector(".media-slot--away");
const approachSection = document.querySelector(".approach");

let flipTween;

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

function zonePoints() {
  const y = lenis.scroll;
  const home = approachSection.getBoundingClientRect().top + y;
  const rect = awaySlot.getBoundingClientRect();
  const away = rect.top + y - (window.innerHeight - rect.height) / 2;
  return { home, away };
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
  if (snapping) return;

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
