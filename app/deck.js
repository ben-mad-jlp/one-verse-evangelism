"use strict";
/* ============================================================
   One Verse Evangelism — shared deck runtime

   Owns the scaling stage, the screen model, the chrome and the
   keyboard. Week files add screens and register hooks; they never
   reimplement navigation.

   Hooks (all optional, all arrays of functions):
     Deck.onEnter(fn)   fn(screenId)      — screen became active
     Deck.onNext(fn)    fn(screenId) => bool — return true to consume the
                                          keypress instead of advancing
     Deck.onPrev(fn)    fn(screenId) => bool — same, for going back
     Deck.onReset(fn)   fn(screenId)      — screen entered going forward, so
                                          clear its activity
     Deck.onKey(fn)     fn(key, screenId) => bool — Escape, while a modal is open
     Deck.blocksKeys(fn) fn() => bool     — something modal is open, so the
                                          deck must ignore the keyboard
   ============================================================ */

const Deck = (() => {
  const STAGE_W = 1600, STAGE_H = 1000;

  const hooks = { enter:[], next:[], prev:[], reset:[], key:[], blocks:[] };
  let screens = [], current = 0, menu = null;

  /* Scale the stage to the window, letterboxing on the short axis. */
  function fitStage(){
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    document.documentElement.style.setProperty("--fit", s);
  }

  const steps = i => Array.from(screens[i].querySelectorAll(".step"));
  const id    = () => screens[current].id;

  function goTo(i, { revealAll = false } = {}){
    if (i < 0 || i >= screens.length) return;
    screens[current].classList.remove("active");
    current = i;
    screens[current].classList.add("active");

    // arriving fresh hides the build steps; arriving backwards shows them all
    steps(current).forEach(el => el.classList.toggle("shown", revealAll));

    // Arriving fresh also clears the screen's activity. Stepping back into a
    // screen deliberately does not, so returning never wipes the class's work.
    if (!revealAll) hooks.reset.forEach(fn => fn(id()));

    hooks.enter.forEach(fn => fn(id()));

    document.querySelectorAll("#dots .dot").forEach((d,n) => d.classList.toggle("on", n === current));
    document.querySelectorAll("#menu-list li").forEach((l,n) => l.classList.toggle("on", n === current));
    document.getElementById("prev").disabled = (current === 0);
    document.getElementById("next").disabled = false;
  }

  /* Forward: reveal the next build step, else let a session hook consume the
     press, else move on. */
  function next(){
    const hidden = steps(current).find(el => !el.classList.contains("shown"));
    if (hidden){ hidden.classList.add("shown"); return; }
    if (hooks.next.some(fn => fn(id()))) return;
    if (current < screens.length - 1) goTo(current + 1);
  }

  /* Back is the exact mirror, so every forward press has an undo. */
  function prev(){
    const shown = steps(current).filter(el => el.classList.contains("shown"));
    if (shown.length){ shown[shown.length - 1].classList.remove("shown"); return; }
    if (hooks.prev.some(fn => fn(id()))) return;
    if (current > 0) goTo(current - 1, { revealAll:true });
  }

  const openMenu   = () => { menu.classList.add("open");    menu.setAttribute("aria-hidden","false"); };
  const closeMenu  = () => { menu.classList.remove("open"); menu.setAttribute("aria-hidden","true"); };
  const toggleMenu = () => menu.classList.contains("open") ? closeMenu() : openMenu();

  function onKeyDown(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;

    // a session modal owns the keyboard while it is open
    if (hooks.blocks.some(fn => fn())){
      if (k === "Escape") hooks.key.forEach(fn => fn("Escape", id()));
      e.preventDefault();
      return;
    }

    if (k === "Escape"){ closeMenu(); return; }
    if (menu.classList.contains("open")) return;

    /* Arrows only. Letter and number shortcuts are deliberately absent: a
       stray keypress during a live class must never jump the deck or fire an
       activity. Everything else is reached by clicking. */
    if (k === "ArrowRight" || k === " " || k === "PageDown"){ e.preventDefault(); next(); return; }
    if (k === "ArrowLeft"  || k === "PageUp"){ e.preventDefault(); prev(); return; }
  }

  /* Shared screen behaviors, wired once at start.

     Map routes are written as the places they pass through (data-through)
     and drawn as one smooth curve: Catmull-Rom, as cubic Béziers. Extra
     points bend a leg without a stop.

     Pronunciation buttons (button.say) play the recording named in
     data-audio, pulsing while it speaks. */
  function wireExtras(){
    /* Pills: a random palette colour each, never the same as the one before. */
    const PILL = ["blue", "coral", "pine", "ink", "sun", "sky"];
    document.querySelectorAll(".pills").forEach(group => {
      let last = "";
      group.querySelectorAll(".pill").forEach(el => {
        const pick = PILL.filter(c => c !== last);
        last = pick[Math.floor(Math.random() * pick.length)];
        el.classList.add("c-" + last);
      });
    });

    document.querySelectorAll("path[data-through]").forEach(el => {
      const p = el.dataset.through.split(",").map(xy => xy.trim().split(/\s+/).map(Number));
      const at = i => p[Math.max(0, Math.min(p.length - 1, i))];
      let d = `M${p[0][0]} ${p[0][1]}`;
      for (let i = 0; i < p.length - 1; i++){
        const [a, b, c, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const c1 = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6];
        const c2 = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6];
        d += `C${c1.map(n => n.toFixed(1)).join(" ")} ${c2.map(n => n.toFixed(1)).join(" ")} ${c[0]} ${c[1]}`;
      }
      el.setAttribute("d", d);
    });

    document.querySelectorAll("button.say").forEach(btn => {
      const audio = new Audio(btn.dataset.audio);
      btn.addEventListener("click", () => {
        audio.currentTime = 0;
        btn.classList.add("playing");
        audio.play().catch(() => btn.classList.remove("playing"));
      });
      audio.addEventListener("ended", () => btn.classList.remove("playing"));
    });
  }

  /* Video screens: <section data-video> with a <video> inside .video-frame.
     The video is bundled with the app, so no internet is needed. Arriving on
     the screen starts it from the beginning; stepping back onto it resumes;
     leaving pauses it. Click the video to pause or play. There are no native
     controls on purpose: a focused player would swallow the arrow keys. */
  function wireVideos(){
    const vids = screens.filter(s => s.dataset.video !== undefined);
    if (!vids.length) return;
    vids.forEach(s => {
      const v = s.querySelector("video");
      v.addEventListener("click", () => v.paused ? v.play() : v.pause());
      v.addEventListener("play",  () => s.classList.remove("paused"));
      v.addEventListener("pause", () => s.classList.toggle("paused", !v.ended && s.classList.contains("active")));
    });
    hooks.reset.push(id => vids.forEach(s => { if (s.id === id) s.querySelector("video").currentTime = 0; }));
    hooks.enter.push(id => vids.forEach(s => {
      const v = s.querySelector("video");
      if (s.id === id) v.play().catch(() => s.classList.add("paused"));
      else { v.pause(); s.classList.remove("paused"); }
    }));
  }

  /* Clicking the slide deliberately does NOT advance — a stray click during an
     activity must never move the deck. Arrows, keyboard, dots and menu only. */
  function start(){
    wireExtras();
    screens = Array.from(document.querySelectorAll(".screen"));
    menu = document.getElementById("menu");

    const dots = document.getElementById("dots");
    const list = document.getElementById("menu-list");
    screens.forEach((s,i) => {
      const d = document.createElement("div");
      d.className = "dot"; d.title = s.dataset.title;
      d.addEventListener("click", () => goTo(i));
      dots.appendChild(d);

      const li = document.createElement("li");
      li.innerHTML = '<span class="label">' + s.dataset.title + '</span>';
      li.addEventListener("click", () => { goTo(i); closeMenu(); });
      list.appendChild(li);
    });

    document.getElementById("next").addEventListener("click", next);
    document.getElementById("prev").addEventListener("click", prev);
    document.getElementById("menu-btn").addEventListener("click", toggleMenu);
    menu.addEventListener("click", e => { if (e.target === menu) closeMenu(); });
    document.addEventListener("keydown", onKeyDown);

    wireVideos();
    window.addEventListener("resize", fitStage);
    fitStage();
    goTo(0);
  }

  return {
    start, goTo, next, prev, closeMenu,
    get current(){ return current; },
    get screens(){ return screens; },
    onEnter:  fn => hooks.enter.push(fn),
    onNext:   fn => hooks.next.push(fn),
    onPrev:   fn => hooks.prev.push(fn),
    onReset:  fn => hooks.reset.push(fn),
    onKey:    fn => hooks.key.push(fn),
    blocksKeys: fn => hooks.blocks.push(fn),
  };
})();
