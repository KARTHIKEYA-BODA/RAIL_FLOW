import { describe, it, expect } from 'vitest';
import {
  haversineDistanceKm,
  computeBearing,
  pointAlongPolyline,
  isCoordInTSR,
  positionOfTrain,
  projectGeoToSvg,
  SCHEMATIC_STATION_COORDS,
} from './kinematicMapEngine';
import {
  HYDERABAD_STATIONS,
  TRACKED_MMTS_TRAINS,
  ACTIVE_TSR_ZONES,
} from './hyderabadGeoData';

describe('kinematicMapEngine', () => {
  const hyb = HYDERABAD_STATIONS.find((s) => s.id === 'HYB')!;
  const sc = HYDERABAD_STATIONS.find((s) => s.id === 'SC')!;

  it('calculates realistic geographical distances between Hyderabad stations', () => {
    const dist = haversineDistanceKm(hyb.lat, hyb.lng, sc.lat, sc.lng);
    // Hyderabad Deccan (Nampally) to Secunderabad is approx 5.5 to 7.0 km straight-line
    expect(dist).toBeGreaterThan(5.0);
    expect(dist).toBeLessThan(7.5);
  });

  it('computes valid compass bearings in range [0, 360)', () => {
    const bearing = computeBearing(hyb.lat, hyb.lng, sc.lat, sc.lng);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
    // Heading from Nampally to Secunderabad is North-East (roughly 20 to 60 degrees)
    expect(bearing).toBeGreaterThan(15);
    expect(bearing).toBeLessThan(65);
  });

  it('interpolates positions accurately along a track polyline', () => {
    const polyline: [number, number][] = [
      [17.3916, 78.4695],
      [17.4125, 78.4856],
      [17.4334, 78.5017],
    ];

    const start = pointAlongPolyline(polyline, 0.0);
    expect(start.lat).toBeCloseTo(17.3916, 4);
    expect(start.lng).toBeCloseTo(78.4695, 4);

    const end = pointAlongPolyline(polyline, 1.0);
    expect(end.lat).toBeCloseTo(17.4334, 4);
    expect(end.lng).toBeCloseTo(78.5017, 4);

    const mid = pointAlongPolyline(polyline, 0.5);
    expect(mid.lat).toBeGreaterThan(17.3916);
    expect(mid.lat).toBeLessThan(17.4334);
  });

  it('detects coordinates located within active TSR-14 speed restriction zone', () => {
    const tsr = ACTIVE_TSR_ZONES[0];
    const insidePt = tsr.coordinates[1];
    expect(isCoordInTSR(insidePt[0], insidePt[1])).toBe(true);

    // Kacheguda station is far away from TSR-14 zone
    const kcg = HYDERABAD_STATIONS.find((s) => s.id === 'KCG')!;
    expect(isCoordInTSR(kcg.lat, kcg.lng)).toBe(false);
  });

  it('accurately computes live state and kinematic speed of MMTS trains', () => {
    const mmts47155 = TRACKED_MMTS_TRAINS.find((t) => t.trainNumber === '47155')!;

    // 1. Before departure: state should be dwelling at origin FM (0 to 5m)
    const earlyState = positionOfTrain(mmts47155, 2);
    expect(['dwelling', 'scheduled-future']).toContain(earlyState.state);
    expect(earlyState.speedKmh).toBe(0);

    // 2. While running mid-journey (minute 25 between KCG and VAR): state should be moving
    const midState = positionOfTrain(mmts47155, 25);
    expect(midState.state).toBe('moving');
    expect(midState.speedKmh).toBeGreaterThanOrEqual(20);
    expect(midState.speedKmh).toBeLessThanOrEqual(90);

    // 3. After completion (minute 120): state should be completed
    const lateState = positionOfTrain(mmts47155, 120);
    expect(lateState.state).toBe('completed');
    expect(lateState.speedKmh).toBe(0);
  });

  it('detects headway overlap clash for conflict trains (T104 / T107)', () => {
    const t104 = TRACKED_MMTS_TRAINS.find((t) => t.trainNumber === 'T104')!;
    // T104 departs HYB at min 15 and arrives at SC PF 1 at min 35. At min 32 it is approaching SC.
    const clashState = positionOfTrain(t104, 32);
    expect(clashState.hasConflict).toBe(true);
    expect(clashState.conflictDescription).toBeDefined();
  });

  it('projects geographic coordinates strictly into SVG bounding box with padding', () => {
    const [x, y] = projectGeoToSvg(hyb.lat, hyb.lng, 1000, 720, 60);
    expect(x).toBeGreaterThanOrEqual(60);
    expect(x).toBeLessThanOrEqual(940);
    expect(y).toBeGreaterThanOrEqual(60);
    expect(y).toBeLessThanOrEqual(660);
  });

  it('contains valid schematic topological coordinates for all major stations', () => {
    const requiredCodes = ['HYB', 'SC', 'KCG', 'BMT', 'LPI', 'FM'];
    for (const code of requiredCodes) {
      expect(SCHEMATIC_STATION_COORDS[code]).toBeDefined();
      expect(SCHEMATIC_STATION_COORDS[code].length).toBe(2);
    }
  });
});
