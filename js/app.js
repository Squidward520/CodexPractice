(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const sim = new EvoSim.Simulation();
  const renderer = new EvoRender.DishRenderer($('dish'));
  let running = true, speed = 1, accumulator = 0, lastFrame = null;
  let selectedId = null, lastUi = -Infinity, chartTick = -1, chartWidth = 0;
  const sliders = ['food-rate', 'mutation-rate', 'initial-population'];
  const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const currentConfig = () => ({
    seed: $('seed').value.trim() || EvoSim.DEFAULT_CONFIG.seed,
    initialPopulation: Number($('initial-population').value),
    foodRate: Number($('food-rate').value),
    mutationRate: Number($('mutation-rate').value) / 100,
  });
  function notify(message) { $('notification').textContent = message; }
  function updatePending() {
    const config = currentConfig();
    const changed = config.seed !== sim.config.seed || config.initialPopulation !== sim.config.initialPopulation;
    $('pending-notice').hidden = !changed;
  }
  function updateSliders() {
    for (const id of sliders) {
      const input = $(id);
      $(`${id}-value`).textContent = input.value;
      input.style.setProperty('--range-progress', `${(input.value - input.min) / (input.max - input.min) * 100}%`);
    }
  }
  function updateStatus() {
    const extinct = !sim.organisms.length;
    $('status-label').textContent = extinct ? '种群已灭绝' : running ? '实验运行中' : '实验已暂停';
    $('status-dot').classList.toggle('paused', !running || extinct);
    $('toggle-run').textContent = running ? 'Ⅱ 暂停实验' : '▷ 继续实验';
    $('toggle-run').setAttribute('aria-pressed', String(!running));
    $('extinction-notice').hidden = !extinct;
    document.querySelectorAll('[data-speed]').forEach(button => {
      const active = Number(button.dataset.speed) === speed;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  function updateInspector() {
    const o = sim.organisms.find(item => item.id === selectedId);
    if (!o) {
      $('inspector').innerHTML = `<div class="inspector-empty"><span class="target-mark" aria-hidden="true">⌖</span><p>${selectedId === null ? '选择一个生命体' : '这个生命体已死亡'}</p><small>${selectedId === null ? '点击培养皿中的个体，观察它的特征' : '选择其他个体，继续观察演化'}</small></div>`;
      return;
    }
    const capacity = EvoSim.maxEnergy(o);
    $('inspector').innerHTML = `<div class="specimen-heading"><span class="specimen-color" style="background:${EvoRender.color(o.speed)}"></span><strong>个体 #${String(o.id).padStart(3, '0')}</strong><span>第 ${o.generation} 代</span></div>
      <div class="energy-label"><span>能量储备</span><span>${o.energy.toFixed(1)} / ${capacity.toFixed(0)}</span></div>
      <div class="energy-track"><span style="width:${Math.min(100, Math.max(0, o.energy / capacity * 100))}%"></span></div>
      <dl class="specimen-grid"><div><dt>年龄</dt><dd>${o.age.toFixed(1)} <small>s</small></dd></div><div><dt>移动速度</dt><dd>${o.speed.toFixed(1)} <small>px/s</small></dd></div><div><dt>感知半径</dt><dd>${o.sense.toFixed(1)} <small>px</small></dd></div><div><dt>身体半径</dt><dd>${o.size.toFixed(2)} <small>px</small></dd></div></dl>`;
  }
  function updateUI(force = false) {
    const stats = sim.stats();
    $('population').textContent = stats.population;
    $('avg-speed').textContent = stats.avgSpeed.toFixed(1);
    $('avg-sense').textContent = stats.avgSense.toFixed(1);
    $('avg-size').textContent = stats.avgSize.toFixed(2);
    $('total-births').textContent = stats.births;
    $('total-deaths').textContent = stats.deaths;
    $('max-generation').textContent = stats.maxGeneration;
    $('food-count').textContent = stats.foodCount;
    $('sim-time').textContent = formatTime(sim.time);
    $('seed-label').textContent = sim.config.seed;
    const width = $('population-chart').clientWidth;
    if (force || chartTick !== Math.floor(sim.time) || width !== chartWidth) {
      EvoRender.drawChart($('population-chart'), sim.history);
      $('chart-range').textContent = `${Math.floor(sim.history[0]?.time || 0)}–${Math.floor(sim.time)} s · 每秒采样`;
      $('population-chart').setAttribute('aria-label', `种群曲线，当前 ${stats.population} 个生命体，模拟时间 ${Math.floor(sim.time)} 秒`);
      chartTick = Math.floor(sim.time); chartWidth = width;
    }
    updateStatus(); updateInspector();
  }
  function reset() {
    const config = currentConfig();
    $('seed').value = config.seed;
    sim.reset(config); renderer.previous.clear();
    accumulator = 0; lastFrame = null; speed = 1; running = true; selectedId = null;
    updatePending(); updateUI(true);
    renderer.draw(sim);
    notify(`实验已重置：种子 ${sim.config.seed}，初始种群 ${sim.config.initialPopulation}，以 1 倍速运行。`);
  }
  for (const id of sliders) $(id).addEventListener('input', () => {
    updateSliders();
    if (id !== 'initial-population') {
      const config = currentConfig(); sim.setParameters({ foodRate: config.foodRate, mutationRate: config.mutationRate });
      notify('环境参数已更新，将从下一个模拟步生效。');
    }
    updatePending();
  });
  $('seed').addEventListener('input', updatePending);
  $('toggle-run').addEventListener('click', () => {
    running = !running; lastFrame = null; updateStatus();
    notify(running ? '实验已继续。' : '实验已暂停，可以选择个体观察。');
  });
  document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
    speed = Number(button.dataset.speed); updateStatus(); notify(`模拟速度设为 ${speed} 倍。`);
  }));
  $('reset').addEventListener('click', reset); $('apply-reset').addEventListener('click', reset);
  $('dish').addEventListener('click', event => {
    selectedId = renderer.pick(sim, event.clientX, event.clientY)?.id ?? null; updateInspector();
  });
  $('dish').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape' || !sim.organisms.length) selectedId = null;
    else {
      const index = sim.organisms.findIndex(o => o.id === selectedId), direction = event.key === 'ArrowRight' ? 1 : -1;
      selectedId = sim.organisms[(index + direction + sim.organisms.length) % sim.organisms.length].id;
    }
    updateInspector();
  });
  document.addEventListener('visibilitychange', () => { lastFrame = null; });
  function frame(now) {
    if (lastFrame === null) lastFrame = now;
    // Bound catch-up after a slow frame. Never change the simulation timestep.
    if (running && !document.hidden) accumulator += Math.min((now - lastFrame) / 1000, .25) * speed;
    lastFrame = now;
    while (accumulator >= EvoSim.RULES.dt) {
      renderer.capture(sim); sim.step(); accumulator -= EvoSim.RULES.dt;
    }
    renderer.draw(sim, { selectedId, showSense: $('show-sense').checked, alpha: running ? accumulator / EvoSim.RULES.dt : 1 });
    if (now - lastUi >= 150) { updateUI(); lastUi = now; }
    requestAnimationFrame(frame);
  }
  updateSliders(); updatePending(); updateUI(true); requestAnimationFrame(frame);
})();
