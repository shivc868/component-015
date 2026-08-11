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
CustomEase.create("hardExpo", "0.82, 0, 0.18, 0.92");

/* ---------- Smooth scroll ---------- */

const lenis = new Lenis();
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

/* ---------- Flip the media card between sections ---------- */

const mediaCard = document.querySelector(".media-card");
const homeSlot = document.querySelector(".media-slot--home");
const awaySlot = document.querySelector(".media-slot--away");

let flipTween;

function moveMediaTo(slot) {
  if (slot.contains(mediaCard)) return;

  const state = Flip.getState(mediaCard);
  slot.appendChild(mediaCard);

  flipTween?.kill();
  flipTween = Flip.from(state, {
    duration: 1,
    ease: "hardExpo",
    absolute: true,
  });
}

ScrollTrigger.create({
  trigger: ".showcase",
  start: "top 60%",
  onEnter: () => moveMediaTo(awaySlot),
  onLeaveBack: () => moveMediaTo(homeSlot),
});
