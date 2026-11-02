'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, RULES, TRAITS, energyCost, maxEnergy } = require('../js/simulation.js');

function isolated(config = {}) {
  const simulation = new Simulation({ initialPopulation: 1, foodRate: 0, ...config });
  simulation.foods = [];
  return simulation;
}

function advance(simulation, seconds) {
  for (let i = 0; i < Math.round(seconds / RULES.dt); i++) simulation.step();
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`);
}

test('defaults create thirty organisms, random food, and bounded initial traits', () => {
  const simulation = new Simulation();
  assert.equal(simulation.organisms.length, 30);
  assert.equal(simulation.foods.length, 120);
  assert.deepEqual(simulation.history, [{ time: 0, population: 30 }]);
  for (const organism of simulation.organisms) {
    for (const [key, bounds] of Object.entries(TRAITS)) {
      assert.ok(organism[key] >= bounds.initialMin && organism[key] <= bounds.initialMax);
    }
  }
});

test('energy drops by the documented metabolism per simulated second', () => {
  const simulation = isolated();
  const organism = simulation.organisms[0];
  organism.energy = 100;
  advance(simulation, 1);
  close(organism.energy, 100 - energyCost(organism));
  close(organism.age, 1);
  assert.equal(simulation.time, 1);
});

test('speed, sensing, and body size all impose a survival cost', () => {
  const baseline = { speed: 40, sense: 90, size: 5 };
  for (const key of Object.keys(TRAITS)) {
    assert.ok(energyCost({ ...baseline, [key]: baseline[key] * 1.1 }) > energyCost(baseline));
  }
  assert.ok(maxEnergy({ size: 6 }) > maxEnergy({ size: 5 }));
});

test('sensing seeks nearby food while distant food does not guide movement', () => {
  const simulation = isolated();
  const organism = simulation.organisms[0];
  Object.assign(organism, { x: 500, y: 320, angle: Math.PI / 2, turnAt: 100 });
  simulation.foods = [{ id: 1, x: 500 + organism.sense + 10, y: 320 }];
  simulation.step();
  close(organism.x, 500);
  assert.ok(organism.y > 320);
  simulation.foods = [{ id: 2, x: organism.x + 20, y: organism.y }];
  const x = organism.x;
  simulation.step();
  assert.ok(organism.x > x);
  close(organism.angle, 0);
});

test('feeding adds energy once, removes food, and never exceeds storage', () => {
  const simulation = isolated({ initialPopulation: 2 });
  const [a, b] = simulation.organisms;
  Object.assign(a, { x: 500, y: 320, energy: 50 });
  Object.assign(b, { x: 500, y: 320, energy: 50 });
  simulation.foods = [{ id: 1, x: 500, y: 320 }];
  simulation.step();
  close(a.energy + b.energy, 100 + RULES.foodEnergy - (energyCost(a) + energyCost(b)) * RULES.dt);
  assert.equal(simulation.foods.length, 0);
  a.energy = maxEnergy(a) - 1;
  simulation.foods = [{ id: 2, x: a.x, y: a.y }];
  simulation.step();
  close(a.energy, maxEnergy(a));
});

test('larger bodies collect food from farther away', () => {
  const small = isolated();
  const large = isolated();
  for (const simulation of [small, large]) {
    Object.assign(simulation.organisms[0], { x: 500, y: 320, speed: 18, size: simulation === small ? 3 : 10 });
    simulation.foods = [{ id: 1, x: 509, y: 320 }];
    simulation.step();
  }
  assert.equal(small.foods.length, 1);
  assert.equal(large.foods.length, 0);
});

test('reproduction requires maturity, sufficient energy, and cooldown', () => {
  const simulation = isolated({ mutationRate: 0 });
  const parent = simulation.organisms[0];
  parent.energy = maxEnergy(parent);
  simulation.step();
  assert.equal(simulation.organisms.length, 1, 'young parent cannot reproduce');
  parent.age = RULES.maturityAge;
  parent.energy = maxEnergy(parent) * RULES.birthThreshold - 1;
  simulation.step();
  assert.equal(simulation.organisms.length, 1, 'low-energy parent cannot reproduce');
  parent.energy = maxEnergy(parent);
  const initial = parent.energy;
  simulation.step();
  assert.equal(simulation.organisms.length, 2);
  const child = simulation.organisms[1];
  assert.equal(child.age, 0, 'newborn is not updated in the birth tick');
  assert.equal(child.parentId, parent.id);
  assert.equal(child.generation, 2);
  for (const key of Object.keys(TRAITS)) assert.equal(child[key], parent[key]);
  close(parent.energy + child.energy, initial - energyCost(parent) * RULES.dt - RULES.birthCost);
  assert.equal(simulation.births, 1);
  parent.energy = maxEnergy(parent);
  simulation.step();
  assert.equal(simulation.organisms.length, 2, 'parent must wait for cooldown');
});

test('mutation stays within relative ±8% and global trait boundaries', () => {
  const simulation = isolated({ mutationRate: 1 });
  const parent = simulation.organisms[0];
  let mutations = 0;
  for (let i = 0; i < 500; i++) {
    for (const [key, bounds] of Object.entries(TRAITS)) {
      parent[key] = i % 2 ? bounds.min : bounds.max;
    }
    const child = simulation.createOrganism(parent);
    for (const [key, bounds] of Object.entries(TRAITS)) {
      assert.ok(child[key] >= bounds.min && child[key] <= bounds.max);
      assert.ok(Math.abs(child[key] / parent[key] - 1) <= RULES.mutationMagnitude + 1e-12);
      if (child[key] !== parent[key]) mutations++;
    }
  }
  assert.ok(mutations > 500);
});

test('exhausted and over-age organisms die without eating or reproducing', () => {
  const simulation = isolated({ initialPopulation: 3 });
  simulation.organisms[0].energy = 0;
  simulation.organisms[1].age = RULES.maxAge;
  for (const organism of simulation.organisms.slice(0, 2)) {
    simulation.foods.push({ id: organism.id, x: organism.x, y: organism.y });
  }
  simulation.step();
  assert.equal(simulation.organisms.length, 1);
  assert.equal(simulation.deaths, 2);
  assert.equal(simulation.births, 0);
});

test('seeded runs remain identical after many births and deaths; seeds differ', () => {
  const a = new Simulation({ seed: 'reproducible' });
  const b = new Simulation({ seed: 'reproducible' });
  const c = new Simulation({ seed: 'different' });
  assert.notDeepEqual(a.organisms, c.organisms);
  advance(a, 90);
  advance(b, 90);
  assert.deepEqual(a, b);
  assert.ok(a.births > 0 && a.deaths > 0);
});

test('reset restores exact initial state, counters, history, food, and random sequence', () => {
  const config = { seed: 'reset-me', initialPopulation: 8, mutationRate: 0.4, foodRate: 12 };
  const simulation = new Simulation(config);
  const fresh = new Simulation(config);
  advance(simulation, 35);
  simulation.reset();
  assert.deepEqual(simulation, fresh);
  advance(simulation, 5);
  advance(fresh, 5);
  assert.deepEqual(simulation, fresh);
  simulation.reset({ ...config, initialPopulation: 12 });
  assert.equal(simulation.organisms.length, 12);
  assert.equal(simulation.time, 0);
});

test('live parameters affect future steps; seed and initial count stay unchanged until reset', () => {
  const simulation = isolated();
  const seed = simulation.config.seed;
  simulation.setParameters({ foodRate: 12, mutationRate: 0.8, initialPopulation: 90, seed: 'ignored' });
  assert.equal(simulation.config.seed, seed);
  assert.equal(simulation.config.initialPopulation, 1);
  assert.equal(simulation.config.mutationRate, 0.8);
  simulation.organisms = [];
  advance(simulation, 1);
  assert.equal(simulation.foods.length, 12);
});

test('population and food caps hold under maximum food and mature fertile population', () => {
  const simulation = isolated({ initialPopulation: RULES.maxPopulation - 1, foodRate: 30 });
  for (const organism of simulation.organisms) {
    organism.age = RULES.maturityAge;
    organism.energy = maxEnergy(organism);
  }
  simulation.step();
  assert.equal(simulation.organisms.length, RULES.maxPopulation);
  assert.equal(simulation.births, 1);
  simulation.organisms = [];
  advance(simulation, 30);
  assert.equal(simulation.foods.length, RULES.maxFood);
  assert.ok(simulation.foodAccumulator < 1);
});

test('empty populations produce finite statistics and history stays bounded', () => {
  const simulation = new Simulation({ initialPopulation: 0, foodRate: 0 });
  advance(simulation, 650);
  assert.equal(simulation.history.length, RULES.historyLimit);
  assert.equal(simulation.history.at(-1).time, 650);
  for (const value of Object.values(simulation.stats())) assert.ok(Number.isFinite(value));
});

test('invalid input is sanitized and organisms reflect off world boundaries', () => {
  const simulation = isolated({ initialPopulation: 900, foodRate: NaN, mutationRate: -1 });
  assert.equal(simulation.config.initialPopulation, RULES.maxPopulation);
  assert.equal(simulation.config.foodRate, 8);
  assert.equal(simulation.config.mutationRate, 0);
  const organism = simulation.organisms[0];
  Object.assign(organism, { x: organism.size, y: organism.size, angle: -Math.PI * 0.75, turnAt: 10 });
  simulation.step();
  assert.ok(organism.x >= organism.size && organism.y >= organism.size);
});
