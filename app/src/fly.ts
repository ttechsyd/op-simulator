// a card or DON!! that travels across the screen on its own layer, flipping over on the way
// when it goes between a face-down place and a face-up one. Screen pixels throughout, so
// the scaled table underneath doesn't matter.

const EASE = "cubic-bezier(0.25, 0.8, 0.25, 1)";

export interface Flight {
  from: DOMRect;
  to: DOMRect;
  img?: string | null;
  // what the card shows at take-off and at landing
  face: "down" | "up" | "flipUp" | "flipDown";
  don?: boolean;
  rot?: number;
  dur?: number;
  delay?: number;
}

function layer() {
  let el = document.getElementById("flyers");
  if (!el) {
    el = document.createElement("div");
    el.id = "flyers";
    document.body.appendChild(el);
  }
  return el;
}

export function fly(f: Flight) {
  const dur = f.dur ?? 460;
  const delay = f.delay ?? 0;
  const w = f.to.width;
  const h = f.to.height;
  const el = document.createElement("div");
  el.className = `flyer ${f.don ? "don-flyer" : ""}`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.innerHTML = `<div class="flyer-in"><div class="flyer-back"></div><div class="flyer-face">${f.img ? `<img src="${f.img}" alt="">` : ""}</div></div>`;
  layer().appendChild(el);

  const s = f.from.width / w;
  const x0 = f.from.left + f.from.width / 2 - w / 2;
  const y0 = f.from.top + f.from.height / 2 - h / 2;
  const a = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(${s}) rotate(${f.rot ?? 0}deg)` },
      { transform: `translate(${f.to.left}px, ${f.to.top}px) scale(1) rotate(0deg)` },
    ],
    { duration: dur, delay, easing: EASE, fill: "both" },
  );
  const start = f.face === "up" || f.face === "flipDown" ? 180 : 0;
  const end = f.face === "up" || f.face === "flipUp" ? 180 : 0;
  el.querySelector<HTMLElement>(".flyer-in")!.animate(
    [{ transform: `rotateY(${start}deg)` }, { transform: `rotateY(${end}deg)` }],
    { duration: dur, delay, easing: "ease-in-out", fill: "both" },
  );
  a.onfinish = () => el.remove();
  return dur + delay;
}

// keep a card out of sight while its flyer is still in the air
export function hideUntil(el: HTMLElement, ms: number) {
  el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.96 }, { opacity: 1 }], { duration: ms });
}
