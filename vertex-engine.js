/*
 * VERTEX ENGINE — motor compartilhado de engenharia e custos
 * Versão: 1.0.0
 * Compatível com navegador (window.VertexEngine) e Node.js (module.exports).
 *
 * Convenções:
 * - comprimento em m;
 * - diâmetro, passo, largura e espessura em mm;
 * - seção em mm²;
 * - peso linear em kg/m;
 * - velocidade em m/h;
 * - custos em R$;
 * - densidade em g/cm³;
 * - percentuais informados como número: 3 = 3%.
 *
 * Os resultados são teóricos/estimados. A liberação de um produto exige
 * amostra, medição de peso/m, passo, dimensões e resistência.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VertexEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PI = Math.PI;
  const DEFAULT_DENSITY = { copper: 8.89, tinnedCopper: 8.89, steel430: 7.70 };
  const DEFAULT_MACHINES = {
    16: { spindles: 16, rpm: 65, maxWiresPerSpindle: 30, minPitch: 20, maxPitch: 200, maxSpeed: 1000 },
    24: { spindles: 24, rpm: 43, maxWiresPerSpindle: 30, minPitch: 20, maxPitch: 200, maxSpeed: 1000 }
  };

  // AWG: diâmetro em mm, área em mm², massa aproximada em kg/km e resistência Ω/km.
  const AWG = {
    14:[1.628,2.08,18.5,8.17], 15:[1.450,1.65,14.7,10.3], 16:[1.291,1.31,11.6,12.9],
    17:[1.150,1.04,9.26,16.34], 18:[1.024,.82,7.3,20.73], 19:[.9116,.65,5.79,26.15],
    20:[.8118,.52,4.61,32.69], 21:[.723,.41,3.64,41.46], 22:[.6438,.33,2.89,51.5],
    23:[.5733,.26,2.29,56.4], 24:[.5106,.20,1.82,85], 25:[.4547,.16,1.44,106.2],
    26:[.4049,.13,1.14,130.7], 27:[.3606,.10,.91,170], 28:[.3211,.08,.72,212.5],
    29:[.2859,.064,.57,265.6], 30:[.2546,.051,.45,333.3], 31:[.2268,.040,.36,425],
    32:[.2019,.032,.28,531.2], 33:[.1798,.0254,.23,669.3], 34:[.1601,.0201,.18,845.8],
    35:[.1426,.0159,.14,1069], 36:[.1270,.0127,.10,1338], 37:[.1131,.0100,.089,1700],
    38:[.1007,.0080,.08,2152], 39:[.0897,.0063,.056,2696], 40:[.0799,.0050,.04,3400],
    41:[.0711,.0040,.035,4250], 42:[.0633,.0032,.028,5312], 43:[.0564,.0025,.022,6800],
    44:[.0503,.0020,.018,8500]
  };

  const n = (value, fallback = 0) => {
    if (typeof value === 'string') value = value.replace(',', '.').trim();
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
  };
  const positiveOr = (value, fallback = 0) => {
    const parsed = n(value, NaN);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : fallback;
  };
  const positive = (value, fallback = 0.000001) => Math.max(positiveOr(value, fallback), fallback);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const round = (value, decimals = 4) => {
    const p = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * p) / p;
  };

  function awgToMm(awg) {
    const a = n(awg);
    return 0.127 * Math.pow(92, (36 - a) / 39);
  }

  function mmToAwg(diameter) {
    const d = positive(diameter);
    return 39 * Math.log(0.127 / d) / Math.log(92) + 36;
  }

  function nearestAwg(diameter, allowed = Object.keys(AWG).map(Number)) {
    const d = positive(diameter);
    return allowed.reduce((best, awg) =>
      Math.abs(awgToMm(awg) - d) < Math.abs(awgToMm(best) - d) ? awg : best,
      allowed[0]
    );
  }

  function wireArea(diameter) {
    const d = positive(diameter);
    return PI * d * d / 4;
  }

  function parseGauge(value) {
    const raw = String(value ?? '').trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    if (!raw) return { error: 'Bitola não informada.' };
    if (/^awg/.test(raw)) {
      const awg = n(raw.replace(/^awg/, ''), NaN);
      if (!Number.isFinite(awg)) return { error: 'AWG inválido.' };
      return { awg, diameter: awgToMm(awg), source: 'awg' };
    }
    const valueNumber = n(raw, NaN);
    if (!Number.isFinite(valueNumber) || valueNumber <= 0) return { error: 'Bitola inválida.' };
    if (raw.includes('mm') || valueNumber < 5) return { diameter: valueNumber, awg: nearestAwg(valueNumber), source: 'diameter' };
    return { awg: valueNumber, diameter: awgToMm(valueNumber), source: 'awg' };
  }

  function parseFormation(text, options = {}) {
    const input = String(text ?? '').trim();
    if (!input) return { error: 'Informe a formação.' };
    const groups = [];
    for (const token of input.split('+')) {
      const compact = token.trim().toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
      const match = compact.match(/^(\d+)x(\d+)(?:x(\d+))?\/\/(.+)$/);
      if (!match) return { error: `Não foi possível interpretar: ${token}. Use 24x8//30.` };
      const spindles = Number(match[1]);
      const wires = Number(match[2]);
      if (spindles < 1 || wires < 1) return { error: 'Fusos e fios por fuso devem ser maiores que zero.' };
      let gaugeText = match[4].replace(/mm$/, '');
      let material = 'copper';
      if (/^430/.test(gaugeText)) { material = 'steel430'; gaugeText = gaugeText.replace(/^430:?/, ''); }
      else if (/^(est|e)$/.test(gaugeText)) { material = 'tinnedCopper'; gaugeText = ''; }
      const gauge = gaugeText ? parseGauge(gaugeText) : {};
      if (gauge.error && !options.allowMissingGauge) return { error: gauge.error };
      const diameter = gauge.diameter || (groups[0] && groups[0].diameter);
      if (!diameter) return { error: `Bitola inválida ou ausente em ${token}.` };
      groups.push({ spindles, wiresPerSpindle: wires, totalWires: spindles * wires, diameter, awg: gauge.awg ?? nearestAwg(diameter), material });
    }
    return {
      groups,
      totalWires: groups.reduce((sum, group) => sum + group.totalWires, 0),
      spindles: groups.reduce((sum, group) => sum + group.spindles, 0),
      wiresPerSpindle: groups.length === 1 ? groups[0].wiresPerSpindle : null,
      diameter: groups.find(group => group.diameter)?.diameter,
      awg: groups.find(group => group.awg)?.awg,
      source: input
    };
  }

  function formatFormation(groups) {
    return groups.map(group => {
      const gauge = group.awg != null && Math.abs(awgToMm(group.awg) - group.diameter) < 0.003
        ? String(group.awg)
        : `${round(group.diameter, 4)}mm`;
      const suffix = group.material === 'steel430' ? `430:${gauge}` : group.material === 'tinnedCopper' ? `${gauge}e` : gauge;
      return `${group.spindles}x${group.wiresPerSpindle}//${suffix}`;
    }).join('+');
  }

  function distribute(totalWires, spindles) {
    const total = Math.max(0, Math.round(n(totalWires)));
    const count = Math.max(1, Math.round(n(spindles)));
    const base = Math.floor(total / count);
    const extra = total % count;
    return {
      totalWires: total, spindles: count, base, extra,
      min: base, max: base + (extra ? 1 : 0), difference: extra ? 1 : 0,
      text: extra
        ? `${extra} fusos com ${base + 1} fios + ${count - extra} fusos com ${base} fios`
        : `${count} fusos com ${base} fios cada`
    };
  }

  function suggestMachine(targetSection, diameter, settings = {}) {
    const target = positive(targetSection);
    const area = wireArea(diameter);
    const machines = [settings.machine16 || DEFAULT_MACHINES[16], settings.machine24 || DEFAULT_MACHINES[24]];
    const pitch = positiveOr(settings.pitch, 50);
    const results = machines.map(machine => {
      const totalWires = Math.max(machine.spindles, Math.round(target / area));
      const distribution = distribute(totalWires, machine.spindles);
      const actualSection = totalWires * area;
      const rpm = positiveOr(machine.rpm, 0);
      const speed = rpm * pitch / 1000 * 60;
      const valid = distribution.max <= positiveOr(machine.maxWiresPerSpindle, Infinity)
        && pitch >= positiveOr(machine.minPitch, 0)
        && pitch <= positiveOr(machine.maxPitch, Infinity)
        && speed <= positiveOr(machine.maxSpeed, Infinity);
      return {
        machine: machine.spindles, rpm, totalWires, distribution, actualSection,
        error: Math.abs(actualSection - target), relativeError: Math.abs(actualSection - target) / target * 100,
        speed, valid, maxWiresPerSpindle: distribution.max
      };
    });
    const eligible = results.filter(result => result.valid);
    const ordered = (eligible.length ? eligible : results).sort((a, b) => a.error - b.error || a.machine - b.machine);
    return { recommended: ordered[0], alternatives: results, hasEligible: eligible.length > 0 };
  }

  function pitchFromAngle(angle, outerDiameter, layFactor = 1) {
    const theta = clamp(n(angle), 0.1, 89.9) * PI / 180;
    return PI * positive(outerDiameter) / Math.tan(theta) * positiveOr(layFactor, 1);
  }

  function angleFromPitch(pitch, outerDiameter, layFactor = 1) {
    const p = positive(pitch);
    const d = positive(outerDiameter);
    return Math.atan((PI * d * positiveOr(layFactor, 1)) / p) * 180 / PI;
  }

  function speedFromRpm(rpm, pitch) {
    return positiveOr(rpm) * positiveOr(pitch) * 60 / 1000;
  }

  function machineSpeed(machine, pitch, efficiency = 100) {
    return speedFromRpm(machine?.rpm, pitch) * clamp(positiveOr(efficiency, 100), 0, 100) / 100;
  }

  function calculateLayer(layer, innerDiameter = 0, options = {}) {
    const angle = clamp(n(layer.angle ?? layer.ang, 30), 0.1, 89.9);
    const cosine = Math.cos(angle * PI / 180);
    const groups = Array.isArray(layer.groups) ? layer.groups : (Array.isArray(layer.g) ? layer.g : []);
    let totalWires = 0, metalSection = 0, arclengthSection = 0, massKgPerM = 0, copperMass = 0, tinnedMass = 0, steelMass = 0, maxDiameter = 0;
    for (const group of groups) {
      const count = positiveOr(group.totalWires, positiveOr(group.spindles) * positiveOr(group.wiresPerSpindle));
      const diameter = positive(group.diameter ?? group.d, 0.2546);
      const material = group.material || group.mat || 'copper';
      const area = wireArea(diameter);
      const section = count * area;
      const density = material === 'steel430' || material === 'steel' || material === 'aco' ? DEFAULT_DENSITY.steel430 : DEFAULT_DENSITY.copper;
      const mass = section * density / cosine / 1000;
      totalWires += count;
      metalSection += section;
      arclengthSection += section / cosine;
      massKgPerM += mass;
      maxDiameter = Math.max(maxDiameter, diameter);
      if (material === 'steel430' || material === 'steel' || material === 'aco') steelMass += mass;
      else if (material === 'tinnedCopper' || material === 'tinned' || material === 'est') tinnedMass += mass;
      else copperMass += mass;
    }
    const inner = positiveOr(innerDiameter, 0);
    const outerDiameter = inner + 2 * maxDiameter;
    const pitch = layer.pitch != null ? positive(layer.pitch) : pitchFromAngle(angle, outerDiameter, layer.layFactor);
    const calculatedAngle = layer.pitch != null ? angleFromPitch(pitch, outerDiameter, layer.layFactor) : angle;
    const wirePathFactor = 1 / cosine;
    return {
      totalWires, metalSection, arclengthSection, massKgPerM, copperMass, tinnedMass, steelMass,
      angle: calculatedAngle, inputAngle: angle, pitch, outerDiameter, innerDiameter: inner,
      wirePathFactor, diameter: maxDiameter,
      resistanceOhmPerKm: calculateResistance(metalSection, { copperMass, tinnedMass, steelMass }),
      rpm: positiveOr(layer.rpm), speedMPerHour: machineSpeed({ rpm: positiveOr(layer.rpm) }, pitch, options.efficiency ?? 100)
    };
  }

  function calculateResistance(section, masses = {}) {
    const s = positive(section);
    const total = positiveOr(masses.copperMass) + positiveOr(masses.tinnedMass) + positiveOr(masses.steelMass);
    if (!total) return 0;
    const copperFraction = (positiveOr(masses.copperMass) + positiveOr(masses.tinnedMass)) / total;
    const steelFraction = positiveOr(masses.steelMass) / total;
    const resistivity = copperFraction * 0.017241 + steelFraction * 0.10;
    return resistivity / s * 1000;
  }

  function calculateCalandra(section, options = {}) {
    const occupancy = clamp(positiveOr(options.occupancy ?? options.compaction, 85), 1, 100) / 100;
    const occupiedArea = positive(section) / occupancy;
    const mode = options.mode || (options.width != null ? 'width' : 'thickness');
    let width, thickness;
    if (mode === 'width') {
      width = positive(options.width, 1);
      thickness = occupiedArea / width;
    } else {
      thickness = positive(options.thickness, 1);
      width = occupiedArea / thickness;
    }
    return { mode, occupancy, occupiedArea, width, thickness, aspectRatio: width / thickness };
  }

  function calculateTechnicalSheet(input = {}) {
    const formation = input.formation && typeof input.formation === 'object' && input.formation.groups
      ? input.formation : parseFormation(input.formation || `${input.spindles || 24}x${input.wiresPerSpindle || input.wires || 8}//${input.awg || input.diameter || 30}`);
    if (formation.error) return formation;
    const groups = formation.groups.map(group => ({ ...group }));
    const innerDiameter = positiveOr(input.innerDiameter ?? input.Di, 0);
    const layers = input.layers || input.cam;
    const layerInputs = Array.isArray(layers) && layers.length
      ? layers.map(layer => ({ ...layer, groups: layer.groups || layer.g }))
      : [{ angle: input.angle ?? input.ang ?? 28, pitch: input.pitch, rpm: input.rpm, groups, layFactor: input.layFactor }];
    let currentInner = innerDiameter;
    const calculatedLayers = [];
    for (const layer of layerInputs) {
      const result = calculateLayer(layer, currentInner, { efficiency: input.efficiency ?? 100 });
      calculatedLayers.push(result);
      currentInner = result.outerDiameter;
    }
    const last = calculatedLayers[calculatedLayers.length - 1];
    const totalMass = calculatedLayers.reduce((sum, item) => sum + item.massKgPerM, 0);
    const totalSection = calculatedLayers.reduce((sum, item) => sum + item.metalSection, 0);
    const machineNumber = input.machine || input.spindles || groups[0]?.spindles;
    const machineConfig = input.machineConfig || DEFAULT_MACHINES[machineNumber] || {};
    const rpm = positiveOr(input.rpm, machineConfig.rpm || 0);
    const pitch = positiveOr(input.pitch, last.pitch);
    const theoreticalSpeed = speedFromRpm(rpm, pitch);
    const effectiveSpeed = theoreticalSpeed * clamp(positiveOr(input.efficiency, 100), 0, 100) / 100;
    const flat = input.format === 'flat' || input.format === 'chata' || input.flat;
    const calandra = flat || input.calandra ? calculateCalandra(totalSection, input.calandra || input) : null;
    const wasteRate = Math.max(0, n(input.waste, 0)) / 100;
    const length = positiveOr(input.length, 0);
    const materialKg = totalMass * length * (1 + wasteRate);
    return {
      formation, formationText: formatFormation(groups), groups, layers: calculatedLayers,
      machine: machineNumber, machineConfig, totalWires: formation.totalWires,
      section: totalSection, metalSection: totalSection, diameter: groups[0]?.diameter,
      awg: groups[0]?.awg, innerDiameter, outerDiameter: last.outerDiameter,
      pitch, angle: last.angle, rpm, theoreticalSpeed, effectiveSpeed,
      efficiency: clamp(positiveOr(input.efficiency, 100), 0, 100),
      linearWeightKgPerM: totalMass, linearWeightGPerM: totalMass * 1000,
      yieldMPerKg: totalMass > 0 ? 1 / totalMass : 0,
      resistanceOhmPerKm: calculateResistance(totalSection, {
        copperMass: calculatedLayers.reduce((s, x) => s + x.copperMass, 0),
        tinnedMass: calculatedLayers.reduce((s, x) => s + x.tinnedMass, 0),
        steelMass: calculatedLayers.reduce((s, x) => s + x.steelMass, 0)
      }),
      calandra, format: flat ? 'flat' : 'round', wasteRate, length, materialKg,
      warnings: [
        ...(formation.groups.some(group => group.material === 'steel430') ? ['Formação contém aço 430; valide material e resistência.'] : []),
        ...(input.pitch == null && input.angle == null ? ['Passo e ângulo foram assumidos.'] : []),
        ...(input.efficiency == null ? ['Eficiência produtiva não informada; foi usado 100%.'] : []),
        'Resultado teórico: validar com amostra, peso/m, passo, dimensões e resistência.'
      ]
    };
  }

  function calculateCosts(sheet, costs = {}) {
    const length = positiveOr(costs.length ?? sheet.length, 0);
    const waste = 1 + Math.max(0, n(costs.waste ?? sheet.wasteRate * 100, 0)) / 100;
    const linearWeight = positiveOr(sheet.linearWeightKgPerM, 0);
    const volume = positiveOr(costs.volume ?? length, 0);
    const materialKg = linearWeight * volume * waste;
    const wirePrice = positiveOr(costs.wirePrice ?? costs.copperPrice, 0);
    const tinAdditional = positiveOr(costs.tinAdditional ?? costs.tin, 0);
    const materialCost = materialKg * (wirePrice + (costs.tinned ? tinAdditional : 0));
    const laborPerM = positiveOr(costs.laborPerM ?? costs.labor, 0);
    const energyPerM = positiveOr(costs.energyPerM ?? costs.energy, 0);
    const indirectPerM = positiveOr(costs.indirectPerM ?? costs.indirect, 0);
    const processCost = volume * (laborPerM + energyPerM + indirectPerM);
    const totalCost = materialCost + processCost;
    const taxRate = Math.max(0, n(costs.taxRate ?? costs.taxes, 0)) / 100;
    const marginRate = Math.max(0, n(costs.marginRate ?? costs.margin, 0)) / 100;
    const denominator = 1 - taxRate - marginRate;
    const suggestedSale = denominator > 0 ? totalCost / denominator : 0;
    const sale = costs.salePrice != null ? positiveOr(costs.salePrice) : suggestedSale;
    const taxes = sale * taxRate;
    const netRevenue = sale - taxes;
    const profit = netRevenue - totalCost;
    const hours = sheet.effectiveSpeed > 0 && volume > 0 ? volume / sheet.effectiveSpeed : 0;
    return {
      volume, materialKg, materialCost, processCost, totalCost, laborCost: volume * laborPerM,
      energyCost: volume * energyPerM, indirectCost: volume * indirectPerM,
      taxRate, marginRate, suggestedSale, sale, taxes, netRevenue, profit,
      realizedMargin: sale > 0 ? profit / sale : 0, hours,
      costPerM: volume > 0 ? totalCost / volume : 0,
      materialCostPerM: volume > 0 ? materialCost / volume : 0,
      processCostPerM: volume > 0 ? processCost / volume : 0
    };
  }

  function createProductDraft(record, options = {}) {
    const formation = record.formation || record.formacao || record.protectedFormation || record.source;
    const parsed = record.groups ? record : parseFormation(formation, { allowMissingGauge: false });
    if (parsed.error) return parsed;
    const first = parsed.groups[0];
    const machine = record.machine || record.spindles || first.spindles;
    const machineConfig = options.machineConfig || DEFAULT_MACHINES[machine] || {};
    const sheet = calculateTechnicalSheet({
      formation: parsed,
      machine,
      angle: options.angle ?? 28,
      pitch: options.pitch,
      rpm: options.rpm ?? machineConfig.rpm,
      efficiency: options.efficiency ?? 85,
      format: options.format || record.format || record.fmt || 'round',
      innerDiameter: options.innerDiameter ?? record.innerDiameter ?? record.Di ?? 0,
      calandra: options.calandra,
      occupancy: options.occupancy ?? record.occupancy ?? 85,
      width: options.width ?? record.width,
      thickness: options.thickness ?? record.thickness,
      waste: options.waste ?? 3,
      length: options.length ?? record.length ?? 1000
    });
    return {
      name: options.name || `Pré-cadastro ${record.code || record.codigo || ''}${record.code || record.codigo ? ' · ' : ''}${machine} fusos`,
      code: record.code || record.codigo || '',
      status: record.status || 'candidate',
      sourceFormation: formation,
      technicalSheet: sheet,
      financial: calculateCosts(sheet, options.costs || { volume: options.length ?? 1000, wirePrice: 55, waste: 3, laborPerM: 2.5, energyPerM: .5, indirectPerM: 1.5, taxRate: 18, marginRate: 25 }),
      warnings: sheet.warnings
    };
  }

  function canUseFormation(record) {
    const status = String(record.status || '').toLowerCase();
    const material = String(record.material || '').toLowerCase();
    const hasAlert = Boolean(record.flags || record.alert || record.review || status === 'revisar' || material.includes('misto') || material.includes('especial'));
    return { allowed: !hasAlert, reason: hasAlert ? 'Formação exige revisão manual antes da precificação.' : '' };
  }

  return {
    version: '1.0.0',
    constants: { AWG, DEFAULT_MACHINES, DEFAULT_DENSITY },
    number: n,
    round,
    awgToMm,
    mmToAwg,
    nearestAwg,
    wireArea,
    parseGauge,
    parseFormation,
    formatFormation,
    distribute,
    suggestMachine,
    pitchFromAngle,
    angleFromPitch,
    speedFromRpm,
    machineSpeed,
    calculateLayer,
    calculateCalandra,
    calculateTechnicalSheet,
    calculateResistance,
    calculateCosts,
    canUseFormation,
    createProductDraft
  };
});
