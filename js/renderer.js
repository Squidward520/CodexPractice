/* Rendering reads simulation state only: no random numbers or model mutations. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const color = speed => `hsl(${155 + Math.min(1, Math.max(0, (speed - 18) / 72)) * 110} 72% 65%)`;

  function surface(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const w = Math.round(width * ratio), h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  class DishRenderer {
    constructor(canvas) { this.canvas = canvas; this.previous = new Map(); }
    capture(sim) { this.previous = new Map(sim.organisms.map(o => [o.id, { x: o.x, y: o.y }])); }
    draw(sim, { selectedId = null, showSense = false, alpha = 1 } = {}) {
      const { ctx, width, height } = surface(this.canvas);
      ctx.scale(width / sim.width, height / sim.height);
      ctx.fillStyle = '#0a141a'; ctx.fillRect(0, 0, sim.width, sim.height);
      ctx.strokeStyle = 'rgba(116,170,177,.07)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= sim.width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, sim.height); }
      for (let y = 0; y <= sim.height; y += 40) { ctx.moveTo(0, y); ctx.lineTo(sim.width, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(116,170,177,.14)';
      for (let x = 40; x < sim.width; x += 160) for (let y = 40; y < sim.height; y += 160) {
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
      }
      for (const f of sim.foods) {
        ctx.fillStyle = 'rgba(225,185,101,.07)'; ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d7b477'; ctx.beginPath(); ctx.arc(f.x, f.y, 1.8, 0, TAU); ctx.fill();
      }
      for (const o of sim.organisms) {
        const prev = this.previous.get(o.id) || o;
        const x = prev.x + (o.x - prev.x) * alpha, y = prev.y + (o.y - prev.y) * alpha;
        const selected = o.id === selectedId;
        if (showSense || selected) {
          ctx.beginPath(); ctx.arc(x, y, o.sense, 0, TAU);
          ctx.fillStyle = selected ? 'rgba(117,223,194,.035)' : 'rgba(117,223,194,.012)'; ctx.fill();
          ctx.setLineDash([3, 6]); ctx.strokeStyle = selected ? 'rgba(117,223,194,.4)' : 'rgba(117,223,194,.09)'; ctx.lineWidth = .8; ctx.stroke(); ctx.setLineDash([]);
        }
        const hue = color(o.speed), r = o.size;
        ctx.globalAlpha = .09; ctx.fillStyle = hue; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(x, y); ctx.rotate(o.angle);
        ctx.strokeStyle = hue; ctx.globalAlpha = .35; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(-r - 4, 4 * Math.sin(sim.time * 5 + o.id), -r - 10, 1); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = hue; ctx.globalAlpha = .16; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.12, r, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(r * .18, 0, Math.max(1.5, r * .34), 0, TAU); ctx.fill();
        ctx.fillStyle = '#d8fff0'; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(r * .3, -r * .2, 1, 0, TAU); ctx.fill(); ctx.restore();
        // Energy arc is a visual meter, separate from the physical body.
        const capacity = root.EvoSim.maxEnergy(o);
        ctx.strokeStyle = hue; ctx.globalAlpha = .5; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, o.energy / capacity))); ctx.stroke(); ctx.globalAlpha = 1;
        if (selected) {
          ctx.strokeStyle = '#d7f6ed'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 8, 0, TAU); ctx.stroke();
          ctx.fillStyle = '#d7f6ed'; ctx.font = '11px monospace'; ctx.fillText(`#${String(o.id).padStart(3, '0')}`, Math.min(x + r + 13, sim.width - 45), Math.max(16, y - 8));
        }
      }
      ctx.strokeStyle = '#61808a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(24, sim.height - 28); ctx.lineTo(124, sim.height - 28); ctx.moveTo(24, sim.height - 32); ctx.lineTo(24, sim.height - 24); ctx.moveTo(124, sim.height - 32); ctx.lineTo(124, sim.height - 24); ctx.stroke();
      ctx.fillStyle = '#6f8992'; ctx.font = '10px monospace'; ctx.fillText('100 px', 59, sim.height - 38);
    }
    pick(sim, clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width * sim.width, y = (clientY - rect.top) / rect.height * sim.height;
      let best = null, distance = 22 * sim.width / rect.width;
      for (const o of sim.organisms) { const d = Math.hypot(o.x - x, o.y - y); if (d < distance) { best = o; distance = d; } }
      return best;
    }
  }

  function drawChart(canvas, history) {
    const { ctx, width, height } = surface(canvas);
    const left = 36, right = width - 12, top = 12, bottom = height - 26;
    if (right <= left || bottom <= top) return;
    const peak = Math.max(40, ...history.map(p => p.population));
    const ceiling = Math.ceil(peak / 20) * 20;
    const start = history[0]?.time || 0, end = Math.max(start + 30, history.at(-1)?.time || 0);
    const X = t => left + (t - start) / (end - start) * (right - left);
    const Y = p => bottom - p / ceiling * (bottom - top);
    ctx.font = '10px ui-monospace, monospace'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = top + (bottom - top) * i / 4;
      ctx.strokeStyle = '#203039'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#71858e'; ctx.textAlign = 'right'; ctx.fillText(String(Math.round(ceiling * (1 - i / 4))), left - 10, y + 3);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) { const t = start + (end - start) * i / 4; ctx.fillText(`${Math.round(t)}s`, X(t), height - 7); }
    if (!history.length) return;
    ctx.beginPath(); history.forEach((p, i) => { if (!i) ctx.moveTo(X(p.time), Y(p.population)); else ctx.lineTo(X(p.time), Y(p.population)); });
    ctx.strokeStyle = '#70d7ba'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(X(history.at(-1).time), bottom); ctx.lineTo(X(history[0].time), bottom); ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, bottom); fill.addColorStop(0, 'rgba(99,211,178,.18)'); fill.addColorStop(1, 'rgba(99,211,178,0)'); ctx.fillStyle = fill; ctx.fill();
    const last = history.at(-1); ctx.beginPath(); ctx.arc(X(last.time), Y(last.population), 3, 0, TAU); ctx.fillStyle = '#9cebd3'; ctx.fill();
  }
  root.EvoRender = { DishRenderer, drawChart, color };
})(globalThis);
