/* ============================================================
   Typer: when one of OUR blue messages is revealed on a click,
   type it into the phone's iMessage field first (with the odd
   typo + backspace, or an autocorrect), then "send" it up into
   the thread. Jumping to a screen with everything revealed, or
   stepping back, skips the show and just sets the final state.
   ============================================================ */
(function(){
  "use strict";

  const SEND = '<svg class="send" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12"/><path d="M12 17.5V7M7.5 11.2L12 6.7l4.5 4.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const runs = new Map();          // phone element -> current run

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  function plainText(bubble){
    const c = bubble.cloneNode(true);
    c.querySelectorAll(".blank").forEach(b => b.textContent = "_____");
    return c.textContent.replace(/\s+/g, " ").trim();
  }

  // pick a word to fumble: a longer word somewhere in the middle
  function pickWord(text){
    const words = [...text.matchAll(/[A-Za-z]{5,}/g)];
    if (!words.length) return null;
    const w = words[Math.min(words.length - 1, Math.floor(words.length / 2))];
    const i = 1 + (hash(w[0]) % (w[0].length - 2));
    const wrong = w[0].slice(0, i) + w[0][i + 1] + w[0][i] + w[0].slice(i + 2);
    return { start: w.index, word: w[0], wrong };
  }

  function field(phone){
    const f = phone.querySelector(".compose .field");
    if (!f.querySelector(".typed")){
      f.insertAdjacentHTML("beforeend", '<span class="typed"></span>' + SEND);
    }
    return f;
  }

  function clearField(phone){
    const f = field(phone);
    f.classList.remove("busy");
    f.querySelector(".typed").innerHTML = "";
  }

  function finish(run){
    if (!run || run.done) return;
    run.done = true;
    clearField(run.phone);
    run.bubble.classList.remove("pending");
    if (runs.get(run.phone) === run) runs.delete(run.phone);
  }

  async function play(bubble){
    const phone = bubble.closest(".iphone");
    finish(runs.get(phone));                         // a quick click finishes the last one
    const run = { phone, bubble, done:false };
    runs.set(phone, run);
    bubble.classList.add("pending");

    const f = field(phone), out = f.querySelector(".typed");
    const text = plainText(bubble);
    const mode = hash(text) % 3;                     // 0 typo + backspace, 1 clean, 2 autocorrect
    const slip = mode === 1 ? null : pickWord(text);
    const per = Math.max(22, Math.min(55, 2600 / text.length));   // long messages type faster
    let typed = "";
    const show = (extra = "") => { out.innerHTML = esc(typed) + extra + '<i class="caret"></i>'; };
    const key = async (ch) => {
      if (!bubble.closest(".screen.active")) finish(run);
      if (run.done) throw 0;
      typed += ch; show();
      await wait(per * (0.55 + Math.random() * 0.9) + (ch === " " ? per * 0.6 : 0) + (/[.,?]/.test(ch) ? 160 : 0));
    };

    try{
      f.classList.add("busy"); show();
      await wait(350);
      let i = 0;
      while (i < text.length){
        if (slip && i === slip.start){
          for (const ch of slip.wrong) await key(ch);
          if (mode === 0){                           // notice it, backspace, fix it
            await wait(380);
            for (let k = 0; k < 3; k++){ if (run.done) throw 0; typed = typed.slice(0, -1); show(); await wait(95); }
            for (const ch of slip.word.slice(slip.word.length - 3)) await key(ch);
          } else {                                   // autocorrect swaps it when the space goes in
            const base = typed.slice(0, -slip.wrong.length);
            typed = base; show('<span class="ac">' + esc(slip.wrong) + '</span>');
            await wait(320);
            if (run.done) throw 0;
            out.innerHTML = esc(base) + '<span class="ac fixed">' + esc(slip.word) + '</span><i class="caret"></i>';
            typed = base + slip.word;
            await wait(420);
          }
          i += slip.word.length;
          continue;
        }
        await key(text[i]); i++;
      }
      await wait(450);
      if (run.done) throw 0;
      f.classList.add("tap"); await wait(160); f.classList.remove("tap");
      finish(run);
      bubble.classList.add("sent");
      setTimeout(() => bubble.classList.remove("sent"), 700);
    } catch(_){ /* cancelled */ }
  }

  function esc(s){ return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function cancelIn(scope){
    runs.forEach(run => { if (scope.contains(run.phone)) finish(run); });
  }

  // everything in the thread before `el` has finished its entrance: skip any animation still running
  function settleBefore(el){
    const msgs = el.closest(".msgs"); if (!msgs) return;
    for (const c of msgs.children){ if (c === el) break; c.classList.add("done"); }
  }
  // stepping back: whatever comes from `el` onward may animate again when it returns
  function unsettleFrom(el){
    const msgs = el.closest(".msgs"); if (!msgs) return;
    let on = false;
    for (const c of msgs.children){ if (c === el) on = true; if (on) c.classList.remove("done"); }
  }

  function start(){
    const screens = [...document.querySelectorAll(".screen")].filter(s => s.querySelector(".iphone .msgs"));
    const watched = [];
    screens.forEach(sc => sc.querySelectorAll(".step").forEach(el => watched.push(el)));
    const obs = new MutationObserver(recs => {
      const newly = [], hidden = [];
      recs.forEach(r => {
        const el = r.target, on = el.classList.contains("shown"), was = (r.oldValue || "").split(/\s+/).includes("shown");
        if (on && !was) newly.push(el);
        if (!on && was) hidden.push(el);
      });
      hidden.forEach(el => {
        const sc = el.closest(".screen");
        runs.forEach(run => { if (sc && sc.contains(run.phone)) finish(run); });   // any step back stops our typing
        el.classList.remove("pending");
        unsettleFrom(el);
      });
      if (!newly.length) return;
      const sc = newly[0].closest(".screen");
      if (newly.length > 1 || !sc || !sc.classList.contains("active")){
        // jump / reveal all: no performance, everything simply there
        newly.forEach(el => { el.classList.remove("pending"); el.classList.add("done"); settleBefore(el); });
        if (sc) sc.querySelectorAll(".msgs > *").forEach(c => c.classList.add("done"));
        return;
      }
      const el = newly[0];
      runs.forEach(run => { if (sc.contains(run.phone)) finish(run); });       // a quick click finishes what was typing
      settleBefore(el);                                                          // and lands anything still arriving
      if (el.matches(".iphone .bubble.me")) play(el);
    });
    watched.forEach(el => obs.observe(el, { attributes:true, attributeFilter:["class"], attributeOldValue:true }));
    if (window.Deck && Deck.onReset) Deck.onReset(id => {
      const s = document.getElementById(id); if (!s) return;
      cancelIn(s);
      s.querySelectorAll(".msgs > .done").forEach(c => c.classList.remove("done"));
    });
  }


  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
