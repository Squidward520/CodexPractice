(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EvoSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({
    seed: 'EVOLAB-2026', initialPopulation: 30, foodRate: 8, mutationRate: 0.15,
  });
  const RULES = Object.freeze({
    width: 1000, height: 640, dt: 1 / 30, maxPopulation: 300, maxFood: 600,
    initialFood: 120, foodRadius: 2.5, foodEnergy: 26,
    maturityAge: 12, maxAge: 140, birthCooldown: 12, birthThreshold: 0.82,
    birthCost: 12, offspringShare: 0.45, mutationMagnitude: 0.08,
    historyLimit: 600, gridSize: 80,
  });
  const TRAITS = Object.freeze({
    speed: Object.freeze({ min: 18, max: 90, initialMin: 34, initialMax: 54 }),
    sense: Object.freeze({ min: 35, max: 180, initialMin: 65, initialMax: 115 }),
    size: Object.freeze({ min: 3, max: 10.5, initialMin: 4, initialMax: 7.5 }),
  });
  const TRAIT_NAMES = Object.keys(TRAITS);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const boundedNumber = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, min, max) : fallback;
  };
  const maxEnergy = organism => 75 + 12 * organism.size;
  const energyCost = organism => 0.35 + 0.0005 * organism.speed ** 2
    + 0.000025 * organism.sense ** 2 + 0.018 * organism.size ** 2;

  // FNV-1a string hashing and Mulberry32; never use wall time or Math.random.
  function hashSeed(seed) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }

  class Simulation {
    constructor(config = {}) {
      this.width = RULES.width;
      this.height = RULES.height;
      this.reset(config);
    }

    random() {
      this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
      let value = this.randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    reset(config = this.config) {
      const source = { ...DEFAULT_CONFIG, ...config };
      this.config = {
        seed: String(source.seed),
        initialPopulation: Math.round(boundedNumber(source.initialPopulation, 30, 0, RULES.maxPopulation)),
        foodRate: boundedNumber(source.foodRate, 8, 0, 30),
        mutationRate: boundedNumber(source.mutationRate, 0.15, 0, 1),
      };
      this.randomState = hashSeed(this.config.seed);
      this.tick = 0;
      this.time = 0;
      this.births = 0;
      this.deaths = 0;
      this.maxGeneration = this.config.initialPopulation ? 1 : 0;
      this.foodAccumulator = 0;
      this.nextOrganismId = 1;
      this.nextFoodId = 1;
      this.organisms = [];
      this.foods = [];
      for (let i = 0; i < this.config.initialPopulation; i++) {
        this.organisms.push(this.createOrganism());
      }
      for (let i = 0; i < RULES.initialFood; i++) this.spawnFood();
      this.history = [{ time: 0, population: this.organisms.length }];
      return this;
    }

    // These are the only live controls. Seed and initialPopulation require reset.
    setParameters(parameters = {}) {
      for (const [key, min, max] of [['foodRate', 0, 30], ['mutationRate', 0, 1]]) {
        if (Object.hasOwn(parameters, key)) {
          this.config[key] = boundedNumber(parameters[key], this.config[key], min, max);
        }
      }
    }

    createOrganism(parent = null) {
      const genes = {};
      for (const key of TRAIT_NAMES) {
        const bounds = TRAITS[key];
        if (parent) {
          let gene = parent[key];
          if (this.random() < this.config.mutationRate) {
            gene *= 1 + (this.random() * 2 - 1) * RULES.mutationMagnitude;
          }
          genes[key] = clamp(gene, bounds.min, bounds.max);
        } else {
          genes[key] = bounds.initialMin + this.random() * (bounds.initialMax - bounds.initialMin);
        }
      }
      const angle = this.random() * Math.PI * 2;
      const offset = parent ? parent.size + genes.size + 1 : 0;
      return {
        id: this.nextOrganismId++, parentId: parent ? parent.id : null,
        generation: parent ? parent.generation + 1 : 1,
        x: parent ? clamp(parent.x + Math.cos(angle) * offset, genes.size, this.width - genes.size)
          : genes.size + this.random() * (this.width - 2 * genes.size),
        y: parent ? clamp(parent.y + Math.sin(angle) * offset, genes.size, this.height - genes.size)
          : genes.size + this.random() * (this.height - 2 * genes.size),
        angle, ...genes, age: 0, energy: parent ? 0 : maxEnergy(genes) * 0.64,
        lastBirthAge: -RULES.birthCooldown,
        turnAt: 0,
      };
    }

    spawnFood() {
      if (this.foods.length >= RULES.maxFood) return;
      this.foods.push({
        id: this.nextFoodId++,
        x: RULES.foodRadius + this.random() * (this.width - 2 * RULES.foodRadius),
        y: RULES.foodRadius + this.random() * (this.height - 2 * RULES.foodRadius),
      });
    }

    foodGrid() {
      const grid = new Map();
      for (const food of this.foods) {
        const key = `${Math.floor(food.x / RULES.gridSize)},${Math.floor(food.y / RULES.gridSize)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(food);
      }
      return grid;
    }

    nearestFood(organism, grid, eaten) {
      let nearest = null;
      let distanceSquared = organism.sense ** 2;
      const xMin = Math.floor((organism.x - organism.sense) / RULES.gridSize);
      const xMax = Math.floor((organism.x + organism.sense) / RULES.gridSize);
      const yMin = Math.floor((organism.y - organism.sense) / RULES.gridSize);
      const yMax = Math.floor((organism.y + organism.sense) / RULES.gridSize);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const bucket = grid.get(`${x},${y}`);
          if (!bucket) continue;
          for (const food of bucket) {
            if (eaten.has(food.id)) continue;
            const distance = (food.x - organism.x) ** 2 + (food.y - organism.y) ** 2;
            if (distance < distanceSquared || (distance === distanceSquared && (!nearest || food.id < nearest.id))) {
              nearest = food;
              distanceSquared = distance;
            }
          }
        }
      }
      return nearest;
    }

    move(organism, target) {
      const dt = RULES.dt;
      if (target) {
        organism.angle = Math.atan2(target.y - organism.y, target.x - organism.x);
      } else if (organism.age >= organism.turnAt) {
        organism.angle += (this.random() - 0.5) * 1.5;
        organism.turnAt = organism.age + 0.6 + this.random() * 1.4;
      }
      const distance = target
        ? Math.min(organism.speed * dt, Math.hypot(target.x - organism.x, target.y - organism.y))
        : organism.speed * dt;
      organism.x += Math.cos(organism.angle) * distance;
      organism.y += Math.sin(organism.angle) * distance;
      if (organism.x < organism.size || organism.x > this.width - organism.size) {
        organism.x = organism.x < organism.size ? 2 * organism.size - organism.x
          : 2 * (this.width - organism.size) - organism.x;
        organism.angle = Math.PI - organism.angle;
      }
      if (organism.y < organism.size || organism.y > this.height - organism.size) {
        organism.y = organism.y < organism.size ? 2 * organism.size - organism.y
          : 2 * (this.height - organism.size) - organism.y;
        organism.angle = -organism.angle;
      }
    }

    step() {
      this.tick++;
      this.time = this.tick * RULES.dt;
      this.foodAccumulator += this.config.foodRate * RULES.dt;
      const foodToSpawn = Math.floor(this.foodAccumulator + 1e-10);
      this.foodAccumulator = Math.max(0, this.foodAccumulator - foodToSpawn);
      for (let i = 0; i < foodToSpawn; i++) this.spawnFood();
      const grid = this.foodGrid();
      const eaten = new Set();
      const survivors = [];
      const newborns = [];
      // Reserve against the start-of-tick population. Deaths free slots next tick.
      const availableBirthSlots = RULES.maxPopulation - this.organisms.length;
      for (const organism of this.organisms) {
        organism.age += RULES.dt;
        organism.energy -= energyCost(organism) * RULES.dt;
        if (organism.energy <= 0 || organism.age >= RULES.maxAge) {
          this.deaths++;
          continue;
        }
        const target = this.nearestFood(organism, grid, eaten);
        this.move(organism, target);
        if (target && Math.hypot(target.x - organism.x, target.y - organism.y) <= organism.size + RULES.foodRadius) {
          eaten.add(target.id);
          organism.energy = Math.min(maxEnergy(organism), organism.energy + RULES.foodEnergy);
        }
        if (newborns.length < availableBirthSlots && organism.age >= RULES.maturityAge
          && organism.age - organism.lastBirthAge >= RULES.birthCooldown
          && organism.energy >= maxEnergy(organism) * RULES.birthThreshold) {
          const child = this.createOrganism(organism);
          const availableEnergy = organism.energy - RULES.birthCost;
          child.energy = Math.min(maxEnergy(child), availableEnergy * RULES.offspringShare);
          organism.energy = availableEnergy - child.energy;
          organism.lastBirthAge = organism.age;
          newborns.push(child);
          this.births++;
          this.maxGeneration = Math.max(this.maxGeneration, child.generation);
        }
        survivors.push(organism);
      }
      this.foods = this.foods.filter(food => !eaten.has(food.id));
      this.organisms = survivors.concat(newborns);
      if (this.tick % 30 === 0) {
        this.history.push({ time: this.time, population: this.organisms.length });
        if (this.history.length > RULES.historyLimit) this.history.shift();
      }
      return this;
    }

    stats() {
      const population = this.organisms.length;
      let speed = 0, sense = 0, size = 0;
      for (const organism of this.organisms) {
        speed += organism.speed;
        sense += organism.sense;
        size += organism.size;
      }
      return {
        population, avgSpeed: population ? speed / population : 0,
        avgSense: population ? sense / population : 0,
        avgSize: population ? size / population : 0,
        foodCount: this.foods.length, births: this.births, deaths: this.deaths,
        maxGeneration: this.maxGeneration,
      };
    }
  }

  return Object.freeze({ Simulation, DEFAULT_CONFIG, RULES, TRAITS, energyCost, maxEnergy });
});
