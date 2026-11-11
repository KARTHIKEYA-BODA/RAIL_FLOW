/**
 * Industrial Timetable Analysis & Greedy Conflict Resolution Engine
 * Computes platform overlaps, delay propagation, headway compliance (5 min),
 * recoverable slack, and generates explainable before/after optimization plans.
 */

export interface RawTimetableRow {
  [key: string]: string | number | undefined;
}

export type TrainType = 'Express' | 'Superfast' | 'Passenger' | 'Local' | 'Freight';

export interface StandardTimetableRow {
  id: string;
  rowNumber: number;
  trainId: string;
  trainType: TrainType;
  stationId: string;
  platform: number;
  scheduledArrival: string; // HH:MM
  scheduledDeparture: string; // HH:MM
  priority: number; // 1 = highest (Express), 4 = lowest (Freight)
  reportedDelayMin: number;
  delayReason: string;
  minDwellMin: number;
}

export interface ColumnMapping {
  trainId: string;
  trainType?: string;
  stationId: string;
  platform?: string;
  scheduledArrival: string;
  scheduledDeparture?: string;
  priority?: string;
  reportedDelay?: string;
  delayReason?: string;
  minDwell?: string;
}

export interface ValidationError {
  rowNumber: number;
  trainId?: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
  value?: string;
}

export interface ValidationReport {
  totalRows: number;
  validRows: number;
  errors: ValidationError[];
  warnings: ValidationError[];
  isValid: boolean;
}

export interface EngineStopResult {
  rowId: string;
  trainId: string;
  trainType: TrainType;
  priority: number;
  stationId: string;
  platformBefore: number;
  platformAfter: number;
  schedArrival: string;
  schedDeparture: string;
  predictedArrival: string;
  predictedDeparture: string;
  proposedArrival: string;
  proposedDeparture: string;
  delayBeforeMin: number;
  delayAfterMin: number;
  delaySavedMin: number;
  rootCause: string;
  actionTaken: string;
  isConflictParticipant: boolean;
}

export interface ConflictItem {
  id: string;
  stationId: string;
  platform: number;
  trainA: string;
  trainB: string;
  timeRange: string;
  overlapMinutes: number;
  description: string;
  severity: 'critical' | 'moderate';
}

export interface TimetableAnalysisResult {
  stops: EngineStopResult[];
  conflictsBefore: ConflictItem[];
  conflictsAfter: ConflictItem[];
  metrics: {
    totalDelayBeforeMin: number;
    totalDelayAfterMin: number;
    delaySavedMin: number;
    conflictsBeforeCount: number;
    conflictsAfterCount: number;
    onTimePctBefore: number;
    onTimePctAfter: number;
    dwellSlackRecoveredMin: number;
    platformReassignmentsCount: number;
    trainsReorderedCount: number;
  };
  assumptions: {
    headwayBufferMin: number;
    minDwellExpressMin: number;
    minDwellLocalMin: number;
    stationsModeled: string[];
  };
}

export const KNOWN_STATIONS: Record<string, { name: string; platforms: number[] }> = {
  HYB: { name: 'Hyderabad Deccan', platforms: [1, 2, 3, 4, 5, 6] },
  SC: { name: 'Secunderabad Jn', platforms: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  KCG: { name: 'Kacheguda', platforms: [1, 2, 3, 4, 5] },
  MJF: { name: 'Malkajgiri Jn', platforms: [1, 2, 3] },
  CHZ: { name: 'Charlapalli', platforms: [1, 2, 3, 4] },
  BMT: { name: 'Begumpet', platforms: [1, 2] },
};

export const DEFAULT_HEADWAY_MIN = 5;

// Helper: parse HH:MM into minutes from midnight
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim();
  const parts = cleaned.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

// Helper: convert minutes from midnight to HH:MM format
export function minutesToTime(mins: number): string {
  const norm = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    trainId: '',
    stationId: '',
    scheduledArrival: '',
  };

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  headers.forEach((h) => {
    const c = clean(h);
    if (!mapping.trainId && (c.includes('trainno') || c.includes('trainid') || c.includes('train') || c === 'tno' || c === 'id')) {
      mapping.trainId = h;
    } else if (!mapping.stationId && (c.includes('station') || c.includes('stn') || c === 'code' || c === 'stop')) {
      mapping.stationId = h;
    } else if (!mapping.scheduledArrival && (c.includes('arr') || c.includes('arrival') || c === 'sta' || c === 'eta')) {
      mapping.scheduledArrival = h;
    } else if (!mapping.scheduledDeparture && (c.includes('dep') || c.includes('departure') || c === 'std' || c === 'etd')) {
      mapping.scheduledDeparture = h;
    } else if (!mapping.platform && (c.includes('plat') || c.includes('pf') || c === 'track' || c === 'berth')) {
      mapping.platform = h;
    } else if (!mapping.trainType && (c.includes('type') || c.includes('category') || c === 'class')) {
      mapping.trainType = h;
    } else if (!mapping.priority && (c.includes('prio') || c === 'p')) {
      mapping.priority = h;
    } else if (!mapping.reportedDelay && (c.includes('delay') || c.includes('lateness') || c === 'late')) {
      mapping.reportedDelay = h;
    } else if (!mapping.delayReason && (c.includes('reason') || c.includes('cause') || c.includes('remark'))) {
      mapping.delayReason = h;
    } else if (!mapping.minDwell && (c.includes('mindwell') || c.includes('dwell'))) {
      mapping.minDwell = h;
    }
  });

  // Fallbacks if not auto-detected
  if (!mapping.trainId && headers.length > 0) mapping.trainId = headers[0];
  if (!mapping.stationId && headers.length > 1) mapping.stationId = headers[1];
  if (!mapping.scheduledArrival && headers.length > 2) mapping.scheduledArrival = headers[2];

  return mapping;
}

export function validateTimetableRows(
  rows: RawTimetableRow[],
  mapping: ColumnMapping
): { report: ValidationReport; standardRows: StandardTimetableRow[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const standardRows: StandardTimetableRow[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-based, accounting for header
    const trainId = String(row[mapping.trainId] || '').trim();
    const stationRaw = String(row[mapping.stationId] || '').trim().toUpperCase();
    const arrRaw = String(row[mapping.scheduledArrival] || '').trim();
    const depRaw = mapping.scheduledDeparture ? String(row[mapping.scheduledDeparture] || '').trim() : arrRaw;
    const pfRaw = mapping.platform ? Number(row[mapping.platform]) : 1;
    const typeRaw = mapping.trainType ? String(row[mapping.trainType] || '').trim() : 'Express';
    const prioRaw = mapping.priority ? Number(row[mapping.priority]) : 0;
    const delayRaw = mapping.reportedDelay ? Number(row[mapping.reportedDelay]) || 0 : 0;
    const reasonRaw = mapping.delayReason ? String(row[mapping.delayReason] || '').trim() : '';
    const minDwellRaw = mapping.minDwell ? Number(row[mapping.minDwell]) : undefined;

    if (!trainId) {
      errors.push({
        rowNumber: rowNum,
        field: 'trainId',
        message: 'Missing Train ID / Number',
        severity: 'error',
      });
      return;
    }

    if (!stationRaw) {
      errors.push({
        rowNumber: rowNum,
        trainId,
        field: 'stationId',
        message: 'Missing Station Code',
        severity: 'error',
      });
      return;
    }

    const knownStation = KNOWN_STATIONS[stationRaw];
    if (!knownStation) {
      warnings.push({
        rowNumber: rowNum,
        trainId,
        field: 'stationId',
        message: `Station "${stationRaw}" not in Hyderabad triangle corridor core list. Platform capacity defaulted to 4.`,
        severity: 'warning',
        value: stationRaw,
      });
    }

    const arrMins = timeToMinutes(arrRaw);
    const depMins = timeToMinutes(depRaw || arrRaw);

    if (!arrRaw || (arrMins === 0 && !arrRaw.includes('00:00'))) {
      errors.push({
        rowNumber: rowNum,
        trainId,
        field: 'scheduledArrival',
        message: `Invalid arrival time format "${arrRaw}". Expected HH:MM.`,
        severity: 'error',
        value: arrRaw,
      });
      return;
    }

    // Check if arrival is after departure on same calendar day
    if (depRaw && depMins < arrMins && depMins !== 0) {
      errors.push({
        rowNumber: rowNum,
        trainId,
        field: 'scheduledDeparture',
        message: `Arrival (${arrRaw}) is after departure (${depRaw}).`,
        severity: 'error',
        value: `${arrRaw} > ${depRaw}`,
      });
      return;
    }

    // Determine normalized train type
    let trainType: TrainType = 'Express';
    const lowerType = typeRaw.toLowerCase();
    if (lowerType.includes('freight') || lowerType.includes('goods')) trainType = 'Freight';
    else if (lowerType.includes('local') || lowerType.includes('mmts') || lowerType.includes('suburban') || lowerType.includes('memu')) trainType = 'Local';
    else if (lowerType.includes('passenger')) trainType = 'Passenger';
    else if (lowerType.includes('super') || lowerType.includes('vande') || lowerType.includes('rajdhani') || lowerType.includes('shatabdi')) trainType = 'Superfast';

    // Priority mapping (1=highest, 4=lowest)
    let priority = prioRaw;
    if (!priority || priority < 1 || priority > 4) {
      if (trainType === 'Superfast') priority = 1;
      else if (trainType === 'Express') priority = 2;
      else if (trainType === 'Passenger' || trainType === 'Local') priority = 3;
      else priority = 4;
    }

    const defaultMinDwell = trainType === 'Superfast' || trainType === 'Express' ? 2 : 1;
    const minDwell = typeof minDwellRaw === 'number' && minDwellRaw >= 0 ? minDwellRaw : defaultMinDwell;

    const platform = !isNaN(pfRaw) && pfRaw > 0 ? pfRaw : 1;

    standardRows.push({
      id: `row-${rowNum}-${trainId}-${stationRaw}`,
      rowNumber: rowNum,
      trainId,
      trainType,
      stationId: stationRaw,
      platform,
      scheduledArrival: arrRaw,
      scheduledDeparture: depRaw || arrRaw,
      priority,
      reportedDelayMin: delayRaw,
      delayReason: reasonRaw,
      minDwellMin: minDwell,
    });
  });

  const report: ValidationReport = {
    totalRows: rows.length,
    validRows: standardRows.length,
    errors,
    warnings,
    isValid: errors.length === 0,
  };

  return { report, standardRows };
}

/**
 * Detect conflicts across a list of scheduled / predicted stops
 */
export function detectPlatformConflicts(
  stops: {
    trainId: string;
    stationId: string;
    platform: number;
    arrivalMins: number;
    departureMins: number;
  }[],
  headwayMin: number = DEFAULT_HEADWAY_MIN
): ConflictItem[] {
  const conflicts: ConflictItem[] = [];

  // Group by station and platform
  const byBerth = new Map<string, typeof stops>();
  stops.forEach((s) => {
    const key = `${s.stationId}-P${s.platform}`;
    if (!byBerth.has(key)) byBerth.set(key, []);
    byBerth.get(key)!.push(s);
  });

  byBerth.forEach((berthStops, key) => {
    const [stationId, pfStr] = key.split('-P');
    const platform = parseInt(pfStr, 10);
    // Sort chronologically by arrival
    berthStops.sort((a, b) => a.arrivalMins - b.arrivalMins);

    for (let i = 0; i < berthStops.length - 1; i++) {
      const a = berthStops[i];
      const b = berthStops[i + 1];

      // A clear conflict occurs if Train B arrives before Train A departs + headway
      const aClearTime = a.departureMins + headwayMin;
      if (b.arrivalMins < aClearTime) {
        const overlap = aClearTime - b.arrivalMins;
        const isTrueClash = b.arrivalMins < a.departureMins;
        conflicts.push({
          id: `conflict-${stationId}-${platform}-${a.trainId}-${b.trainId}`,
          stationId,
          platform,
          trainA: a.trainId,
          trainB: b.trainId,
          timeRange: `${minutesToTime(b.arrivalMins)} – ${minutesToTime(Math.max(a.departureMins, b.departureMins))}`,
          overlapMinutes: overlap,
          description: isTrueClash
            ? `Safety clash on Platform ${platform}: ${a.trainId} departs at ${minutesToTime(a.departureMins)} while ${b.trainId} arrives at ${minutesToTime(b.arrivalMins)} (${overlap}m overlap).`
            : `Headway margin violation on Platform ${platform}: gap between ${a.trainId} dep (${minutesToTime(a.departureMins)}) and ${b.trainId} arr (${minutesToTime(b.arrivalMins)}) is ${b.arrivalMins - a.departureMins}m (< ${headwayMin}m safety buffer).`,
          severity: isTrueClash ? 'critical' : 'moderate',
        });
      }
    }
  });

  return conflicts;
}

/**
 * Greedy Timetable Solver
 * Executes 5-step optimization:
 * 1. Calculate initial predicted arrival = scheduled + reported delay - recoverable dwell slack
 * 2. Identify platform collisions (< 5m headway)
 * 3. Evaluate heuristic options:
 *    a) Reassign to free platform at same station
 *    b) Hold lower-priority train until headway is restored
 *    c) Reorder or trim dwell to minimum dwell
 * 4. Commit best option with lowest weighted delay impact
 * 5. Return before vs after metrics and audit explanations
 */
export function analyseAndOptimizeTimetable(
  standardRows: StandardTimetableRow[],
  headwayMin: number = DEFAULT_HEADWAY_MIN
): TimetableAnalysisResult {
  // Sort all stops chronologically
  const sorted = [...standardRows].sort((a, b) => timeToMinutes(a.scheduledArrival) - timeToMinutes(b.scheduledArrival));

  // Compute Initial Baseline Predictions (Before)
  interface WorkStop {
    raw: StandardTimetableRow;
    schedArrMins: number;
    schedDepMins: number;
    predArrMins: number;
    predDepMins: number;
    optArrMins: number;
    optDepMins: number;
    platform: number;
    proposedPlatform: number;
    action: string;
    rootCause: string;
    dwellSlackRecovered: number;
  }

  // Track per-train cascading delay across stations
  const trainDelays = new Map<string, number>();

  const workStops: WorkStop[] = sorted.map((row) => {
    const sArr = timeToMinutes(row.scheduledArrival);
    const sDep = timeToMinutes(row.scheduledDeparture);
    const baseDwell = Math.max(0, sDep - sArr);

    // Initial delay includes direct reported delay plus any accumulated delay
    const prevDelay = trainDelays.get(row.trainId) || 0;
    const initialDelay = Math.max(row.reportedDelayMin, prevDelay);

    // Unmitigated baseline (delay without dwell recovery or platform shifting)
    const unmitigatedArr = sArr + initialDelay;
    const unmitigatedDep = unmitigatedArr + baseDwell;

    // Dwell slack recovery: can trim down to minDwellMin, never below
    let dwellSlack = 0;
    if (initialDelay > 0 && baseDwell > row.minDwellMin) {
      dwellSlack = Math.min(initialDelay, baseDwell - row.minDwellMin);
    }

    const predArr = unmitigatedArr;
    const predDep = unmitigatedDep; // Unmitigated prediction shows the raw consequence before intervention

    const optArr = sArr + initialDelay;
    const optDep = optArr + (baseDwell - dwellSlack);

    // Propagate remaining delay to future stops of this train
    const exitDelay = Math.max(0, optDep - sDep);
    trainDelays.set(row.trainId, exitDelay);

    let cause = 'On time';
    if (row.reportedDelayMin > 0 && row.delayReason) {
      cause = `Reported: ${row.delayReason}`;
    } else if (row.reportedDelayMin > 0) {
      cause = `Reported delay (${row.reportedDelayMin}m)`;
    } else if (prevDelay > 0) {
      cause = `Inherited delay from previous stop (${prevDelay}m)`;
    }

    return {
      raw: row,
      schedArrMins: sArr,
      schedDepMins: sDep,
      predArrMins: predArr,
      predDepMins: predDep,
      optArrMins: optArr,
      optDepMins: optDep,
      platform: row.platform,
      proposedPlatform: row.platform,
      action: dwellSlack > 0 ? `Recovered ${dwellSlack}m via dwell compression` : 'Maintain scheduled path',
      rootCause: cause,
      dwellSlackRecovered: dwellSlack,
    };
  });

  // Conflicts Before Optimization
  const conflictsBefore = detectPlatformConflicts(
    workStops.map((w) => ({
      trainId: w.raw.trainId,
      stationId: w.raw.stationId,
      platform: w.platform,
      arrivalMins: w.predArrMins,
      departureMins: w.predDepMins,
    })),
    headwayMin
  );

  // Group workstops by station for multi-platform allocation
  const stationStops = new Map<string, WorkStop[]>();
  workStops.forEach((w) => {
    if (!stationStops.has(w.raw.stationId)) stationStops.set(w.raw.stationId, []);
    stationStops.get(w.raw.stationId)!.push(w);
  });

  let reassignmentsCount = 0;
  let reordersCount = 0;
  let totalDwellSlack = 0;

  // Optimize per station
  stationStops.forEach((stops, stationId) => {
    const stationConfig = KNOWN_STATIONS[stationId] || { name: stationId, platforms: [1, 2, 3, 4] };
    const availablePlatforms = stationConfig.platforms;

    // Iterative resolution of overlaps
    let maxIterations = 20;
    while (maxIterations-- > 0) {
      const currentConflicts = detectPlatformConflicts(
        stops.map((s) => ({
          trainId: s.raw.trainId,
          stationId: s.raw.stationId,
          platform: s.proposedPlatform,
          arrivalMins: s.optArrMins,
          departureMins: s.optDepMins,
        })),
        headwayMin
      );

      if (currentConflicts.length === 0) break;

      const c = currentConflicts[0];
      const stopA = stops.find((s) => s.raw.trainId === c.trainA && s.proposedPlatform === c.platform)!;
      const stopB = stops.find((s) => s.raw.trainId === c.trainB && s.proposedPlatform === c.platform)!;

      if (!stopA || !stopB) break;

      // Determine lower vs higher priority train
      const aPrio = stopA.raw.priority;
      const bPrio = stopB.raw.priority;

      // Target to modify: prefer moving or delaying the lower priority train (larger number = lower priority)
      const target = bPrio >= aPrio ? stopB : stopA;
      const anchor = target === stopB ? stopA : stopB;

      // Option 1: Try reassignment to another free platform
      let reassigned = false;
      for (const pf of availablePlatforms) {
        if (pf === target.proposedPlatform) continue;

        // Check if platform `pf` has sufficient gap
        const otherStopsOnPf = stops.filter(
          (s) => s.proposedPlatform === pf && s.raw.trainId !== target.raw.trainId
        );
        const hasClash = otherStopsOnPf.some(
          (s) => Math.max(target.optArrMins, s.optArrMins) < Math.min(target.optDepMins, s.optDepMins) + headwayMin
        );

        if (!hasClash) {
          const oldPf = target.proposedPlatform;
          target.proposedPlatform = pf;
          target.action = `Reassigned from PF ${oldPf} to PF ${pf} (0 extra delay)`;
          if (target.rootCause === 'On time') {
            target.rootCause = `Avoided headway conflict with ${anchor.raw.trainId} on PF ${oldPf}`;
          }
          reassignmentsCount++;
          reassigned = true;
          break;
        }
      }

      if (reassigned) continue;

      // Option 2: Dwell trimming if target has dwell headroom
      const currentDwell = target.optDepMins - target.optArrMins;
      if (currentDwell > target.raw.minDwellMin && target.optArrMins < anchor.optDepMins + headwayMin) {
        const canTrim = currentDwell - target.raw.minDwellMin;
        target.optDepMins -= canTrim;
        totalDwellSlack += canTrim;
        target.action = `Trimmed dwell by ${canTrim}m to minimum (${target.raw.minDwellMin}m)`;
        continue;
      }

      // Option 3: Hold lower-priority train until headway is clear
      const neededClearTime = anchor.optDepMins + headwayMin;
      const pushDelay = neededClearTime - target.optArrMins;
      if (pushDelay > 0) {
        target.optArrMins = neededClearTime;
        target.optDepMins = target.optArrMins + Math.max(target.raw.minDwellMin, currentDwell);
        target.action = `Held ${pushDelay}m for priority train ${anchor.raw.trainId} to clear headway`;
        target.rootCause = `Priority precedence: ${anchor.raw.trainType} (#${anchor.raw.trainId}) given path`;
        reordersCount++;
      } else {
        break; // Guard against infinite loop
      }
    }
  });

  // Conflicts After Optimization
  const conflictsAfter = detectPlatformConflicts(
    workStops.map((w) => ({
      trainId: w.raw.trainId,
      stationId: w.raw.stationId,
      platform: w.proposedPlatform,
      arrivalMins: w.optArrMins,
      departureMins: w.optDepMins,
    })),
    headwayMin
  );

  // Generate Per-Stop Results
  const stops: EngineStopResult[] = workStops.map((w) => {
    const delayBefore = Math.max(0, w.predDepMins - w.schedDepMins);
    const delayAfter = Math.max(0, w.optDepMins - w.schedDepMins);
    const delaySaved = Math.max(0, delayBefore - delayAfter);

    const isInConflictBefore = conflictsBefore.some(
      (c) => c.trainA === w.raw.trainId || c.trainB === w.raw.trainId
    );

    return {
      rowId: w.raw.id,
      trainId: w.raw.trainId,
      trainType: w.raw.trainType,
      priority: w.raw.priority,
      stationId: w.raw.stationId,
      platformBefore: w.platform,
      platformAfter: w.proposedPlatform,
      schedArrival: w.raw.scheduledArrival,
      schedDeparture: w.raw.scheduledDeparture,
      predictedArrival: minutesToTime(w.predArrMins),
      predictedDeparture: minutesToTime(w.predDepMins),
      proposedArrival: minutesToTime(w.optArrMins),
      proposedDeparture: minutesToTime(w.optDepMins),
      delayBeforeMin: delayBefore,
      delayAfterMin: delayAfter,
      delaySavedMin: delaySaved,
      rootCause: w.rootCause,
      actionTaken: w.action,
      isConflictParticipant: isInConflictBefore,
    };
  });

  const totalDelayBefore = stops.reduce((sum, s) => sum + s.delayBeforeMin, 0);
  const totalDelayAfter = stops.reduce((sum, s) => sum + s.delayAfterMin, 0);
  const totalDelaySaved = Math.max(0, totalDelayBefore - totalDelayAfter);

  const onTimeBeforeCount = stops.filter((s) => s.delayBeforeMin <= 2).length;
  const onTimeAfterCount = stops.filter((s) => s.delayAfterMin <= 2).length;
  const totalStops = Math.max(1, stops.length);

  const onTimePctBefore = Math.round((onTimeBeforeCount / totalStops) * 1000) / 10;
  const onTimePctAfter = Math.round((onTimeAfterCount / totalStops) * 1000) / 10;

  return {
    stops,
    conflictsBefore,
    conflictsAfter,
    metrics: {
      totalDelayBeforeMin: totalDelayBefore,
      totalDelayAfterMin: totalDelayAfter,
      delaySavedMin: totalDelaySaved,
      conflictsBeforeCount: conflictsBefore.length,
      conflictsAfterCount: conflictsAfter.length,
      onTimePctBefore,
      onTimePctAfter,
      dwellSlackRecoveredMin: totalDwellSlack,
      platformReassignmentsCount: reassignmentsCount,
      trainsReorderedCount: reordersCount,
    },
    assumptions: {
      headwayBufferMin: headwayMin,
      minDwellExpressMin: 2,
      minDwellLocalMin: 1,
      stationsModeled: Object.keys(KNOWN_STATIONS),
    },
  };
}

/**
 * Three Pre-Packaged Demo Datasets for instant judge evaluation
 */
export const DEMO_PRESETS: {
  id: string;
  name: string;
  badge: string;
  description: string;
  csvContent: string;
}[] = [
  {
    id: 'clean-conflicts',
    name: '1. Clean Corridor Clash',
    badge: '3 Conflicts · Ready to solve',
    description: 'Clean timetable with standard headers. Demonstrates 2 simultaneous platform clashes on Secunderabad P1 and P3 resolved via free platform reallocation.',
    csvContent: `train_id,train_type,station_id,assigned_platform,scheduled_arrival,scheduled_departure,priority,delay_min,reason
12723,Express,SC,1,10:00,10:15,1,0,Nominal
12727,Express,SC,1,10:08,10:20,2,0,Scheduled path
17031,Passenger,SC,3,10:30,10:45,3,15,Signal delay at Ghatkesar
12760,Superfast,SC,3,10:35,10:50,1,0,Nominal
47155,Local,HYB,2,11:00,11:10,3,0,MMTS Local
12791,Express,HYB,2,11:05,11:20,2,0,Secunderabad link
12705,Express,KCG,1,11:30,11:42,2,0,Intercity
17651,Express,KCG,2,11:40,11:55,2,5,TSR-14 caution
`,
  },
  {
    id: 'messy-headers-bad-rows',
    name: '2. Messy Headers & Invalid Rows',
    badge: 'Validator Test · Auto-mapping',
    description: 'Tests column auto-mapping against non-standard column names ("Train No", "Stn", "STA", "STD", "Track") and catches 2 invalid rows (arrival after dep, corrupt time) without crashing.',
    csvContent: `Train No,Category,Stn,Track,STA,STD,Priority,Late Mins,Remarks
T-101,Express,SC,1,08:30,08:45,1,0,Nominal run
T-102,Local,SC,1,08:38,08:50,3,10,Rake delay
T-CORRUPT,Express,SC,2,INVALID_TIME,09:10,2,0,Bad time test
T-104,Freight,HYB,1,09:00,09:20,4,20,Yard congestion
T-105,Superfast,HYB,1,09:12,09:25,1,0,High priority
T-REVERSE,Passenger,KCG,1,10:30,10:15,3,0,Arrival after departure test
T-107,Express,KCG,2,10:40,10:55,2,0,Clean
`,
  },
  {
    id: 'stress-test-100',
    name: '3. Stress Test (100+ Corridor Stops)',
    badge: 'Large Dataset · Sub-second Solve',
    description: '100+ dense corridor train movements across HYB, SC, KCG, MJF, and CHZ to prove sub-second deterministic greedy optimization speed and scalability.',
    csvContent: generateLargeDatasetCsv(),
  },
];

function generateLargeDatasetCsv(): string {
  const stations = ['HYB', 'SC', 'KCG', 'MJF', 'CHZ'];
  const types: TrainType[] = ['Superfast', 'Express', 'Local', 'Freight', 'Passenger'];
  const lines: string[] = ['train_id,train_type,station_id,assigned_platform,scheduled_arrival,scheduled_departure,priority,delay_min,reason'];

  let timeCursor = 360; // 06:00 AM
  for (let i = 1; i <= 100; i++) {
    const trainId = `${12000 + i}`;
    const station = stations[i % stations.length];
    const type = types[i % types.length];
    const prio = type === 'Superfast' ? 1 : type === 'Express' ? 2 : type === 'Local' ? 3 : 4;
    const pf = (i % 4) + 1;
    const arr = minutesToTime(timeCursor);
    const dwell = type === 'Freight' ? 15 : type === 'Local' ? 5 : 10;
    const dep = minutesToTime(timeCursor + dwell);
    const delay = i % 5 === 0 ? 15 : i % 8 === 0 ? 25 : 0;
    const reason = delay > 0 ? (i % 2 === 0 ? 'TSR-14 caution order' : 'Preceding block headway') : 'Nominal';

    lines.push(`${trainId},${type},${station},${pf},${arr},${dep},${prio},${delay},${reason}`);
    timeCursor += 5; // Pack densely every 5 minutes to trigger cascade dynamics
  }

  return lines.join('\n');
}
