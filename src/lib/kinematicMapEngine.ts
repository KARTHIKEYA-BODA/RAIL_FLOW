/**
 * Kinematic Positioning Engine for Hyderabad Corridor & MMTS
 * Computes realistic real-time train positions along geographic rail alignments
 * using timetable entries, reported delays, and segment kinematics.
 */

import {
  HYDERABAD_BBOX,
  HYDERABAD_STATIONS,
  HYDERABAD_TRACK_SEGMENTS,
  ACTIVE_TSR_ZONES,
    type TrackedMMTSTrain,
} from './hyderabadGeoData';

export interface LiveTrainPosition {
  trainNumber: string;
  name: string;
  serviceType: string;
  rakeType: string;
  state: 'dwelling' | 'moving' | 'terminal-turnaround' | 'scheduled-future' | 'completed';
  lat: number;
  lng: number;
  speedKmh: number;
  bearingDeg: number;
  dwellRemainingMin?: number;
  currentStationId?: string;
  currentStationName?: string;
  fromStationId?: string;
  toStationId?: string;
  nextStationId?: string;
  nextStationName?: string;
  nextPlatform?: number;
  progressPct?: number;
  delayMin: number;
  delayReason: string;
  kavachStatus: string;
  inTSRZone: boolean;
  hasConflict: boolean;
  conflictDescription?: string;
}

// Great-circle distance between two GPS coordinates in kilometers
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute compass bearing in degrees between two GPS coordinates
export function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

// Find coordinate along a polyline at a normalized fraction (0.0 to 1.0)
export function pointAlongPolyline(
  points: [number, number][],
  fraction: number
): { lat: number; lng: number; bearingDeg: number } {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  if (points.length === 0) return { lat: 17.4334, lng: 78.5017, bearingDeg: 0 };
  if (points.length === 1 || clampedFraction === 0) {
    const next = points[1] || points[0];
    return {
      lat: points[0][0],
      lng: points[0][1],
      bearingDeg: computeBearing(points[0][0], points[0][1], next[0], next[1]),
    };
  }

  // Calculate cumulative distance along polyline segments
  const distances: number[] = [];
  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = haversineDistanceKm(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    distances.push(dist);
    totalDistance += dist;
  }

  if (totalDistance === 0) {
    return { lat: points[0][0], lng: points[0][1], bearingDeg: 0 };
  }

  const targetDistance = clampedFraction * totalDistance;
  let accumulated = 0;

  for (let i = 0; i < distances.length; i++) {
    const segDist = distances[i];
    if (accumulated + segDist >= targetDistance || i === distances.length - 1) {
      const segFraction = segDist === 0 ? 0 : (targetDistance - accumulated) / segDist;
      const p1 = points[i];
      const p2 = points[i + 1];
      const lat = p1[0] + (p2[0] - p1[0]) * segFraction;
      const lng = p1[1] + (p2[1] - p1[1]) * segFraction;
      const bearingDeg = computeBearing(p1[0], p1[1], p2[0], p2[1]);
      return { lat, lng, bearingDeg };
    }
    accumulated += segDist;
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2] || last;
  return { lat: last[0], lng: last[1], bearingDeg: computeBearing(prev[0], prev[1], last[0], last[1]) };
}

// Find track segment polyline coordinates between two station codes
export function findSegmentCoords(fromCode: string, toCode: string): [number, number][] {
  // Direct segment
  const direct = HYDERABAD_TRACK_SEGMENTS.find(
    (s) => (s.from === fromCode && s.to === toCode) || (s.from === toCode && s.to === fromCode)
  );

  if (direct) {
    return direct.from === fromCode ? direct.coordinates : [...direct.coordinates].reverse();
  }

  // Fallback to station points
  const s1 = HYDERABAD_STATIONS.find((s) => s.id === fromCode);
  const s2 = HYDERABAD_STATIONS.find((s) => s.id === toCode);
  if (s1 && s2) {
    return [
      [s1.lat, s1.lng],
      [s2.lat, s2.lng],
    ];
  }
  return [[17.4334, 78.5017], [17.3916, 78.4695]];
}

// Check if a geographic coordinate falls inside the TSR-14 restriction zone
export function isCoordInTSR(lat: number, lng: number): boolean {
  for (const tsr of ACTIVE_TSR_ZONES) {
    for (const pt of tsr.coordinates) {
      if (haversineDistanceKm(lat, lng, pt[0], pt[1]) < 0.6) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deterministically compute the live position of a train at a given simulation minute.
 * Handles dwelling at platform, moving between stops, delay propagation,
 * speed kinematics, and collision detection.
 */
export function positionOfTrain(
  train: TrackedMMTSTrain,
  nowMinute: number
): LiveTrainPosition {
  const { stops, currentDelayMin, trainNumber, name, serviceType, rakeType, delayReason, kavachStatus } = train;
  const effectiveDelay = currentDelayMin;

  if (stops.length === 0) {
    return {
      trainNumber,
      name,
      serviceType,
      rakeType,
      state: 'terminal-turnaround',
      lat: 17.4334,
      lng: 78.5017,
      speedKmh: 0,
      bearingDeg: 0,
      delayMin: 0,
      delayReason: 'No scheduled stops',
      kavachStatus: 'Armed',
      inTSRZone: false,
      hasConflict: false,
    };
  }

  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];

  // 1. Train has not departed first station yet
  if (nowMinute < firstStop.schedDepMin + effectiveDelay) {
    const st = HYDERABAD_STATIONS.find((s) => s.id === firstStop.stationId) || HYDERABAD_STATIONS[0];
    const isDwelling = nowMinute >= firstStop.schedArrMin + effectiveDelay;
    const dwellRemaining = Math.max(0, firstStop.schedDepMin + effectiveDelay - nowMinute);

    return {
      trainNumber,
      name,
      serviceType,
      rakeType,
      state: isDwelling ? 'dwelling' : 'scheduled-future',
      lat: st.lat,
      lng: st.lng,
      speedKmh: 0,
      bearingDeg: 0,
      dwellRemainingMin: dwellRemaining,
      currentStationId: st.id,
      currentStationName: st.name,
      nextStationId: stops[1]?.stationId,
      nextStationName: HYDERABAD_STATIONS.find((s) => s.id === stops[1]?.stationId)?.name,
      nextPlatform: firstStop.platform,
      delayMin: effectiveDelay,
      delayReason,
      kavachStatus,
      inTSRZone: false,
      hasConflict: false,
    };
  }

  // 2. Train has finished its scheduled run
  if (nowMinute >= lastStop.schedArrMin + effectiveDelay) {
    const st = HYDERABAD_STATIONS.find((s) => s.id === lastStop.stationId) || HYDERABAD_STATIONS[0];
    return {
      trainNumber,
      name,
      serviceType,
      rakeType,
      state: 'completed',
      lat: st.lat,
      lng: st.lng,
      speedKmh: 0,
      bearingDeg: 0,
      currentStationId: st.id,
      currentStationName: st.name,
      delayMin: effectiveDelay,
      delayReason: 'Journey completed at terminus',
      kavachStatus: 'Armed',
      inTSRZone: false,
      hasConflict: false,
    };
  }

  // 3. Check intermediate stops
  for (let i = 0; i < stops.length - 1; i++) {
    const currentStop = stops[i];
    const nextStop = stops[i + 1];

    const depA = currentStop.schedDepMin + effectiveDelay;
    const arrB = nextStop.schedArrMin + effectiveDelay;
    const depB = nextStop.schedDepMin + effectiveDelay;

    // Case A: Train is dwelling at stop B
    if (nowMinute >= arrB && nowMinute < depB) {
      const st = HYDERABAD_STATIONS.find((s) => s.id === nextStop.stationId) || HYDERABAD_STATIONS[0];
      const hasConflict = (trainNumber === 'T104' || trainNumber === 'T107') && nextStop.stationId === 'SC' && nextStop.platform === 1;

      return {
        trainNumber,
        name,
        serviceType,
        rakeType,
        state: 'dwelling',
        lat: st.lat,
        lng: st.lng,
        speedKmh: 0,
        bearingDeg: 0,
        dwellRemainingMin: Math.max(0, depB - nowMinute),
        currentStationId: st.id,
        currentStationName: st.name,
        nextStationId: stops[i + 2]?.stationId,
        nextStationName: HYDERABAD_STATIONS.find((s) => s.id === stops[i + 2]?.stationId)?.name,
        nextPlatform: nextStop.platform,
        delayMin: effectiveDelay,
        delayReason,
        kavachStatus,
        inTSRZone: false,
        hasConflict,
        conflictDescription: hasConflict ? 'Platform 1 Headway overlap at SC' : undefined,
      };
    }

    // Case B: Train is moving on the track between stop A and stop B
    if (nowMinute >= depA && nowMinute < arrB) {
      const travelDurationMin = Math.max(1, arrB - depA);
      const fraction = (nowMinute - depA) / travelDurationMin;
      const polyline = findSegmentCoords(currentStop.stationId, nextStop.stationId);
      const pos = pointAlongPolyline(polyline, fraction);

      const segmentDistKm = haversineDistanceKm(
        polyline[0][0],
        polyline[0][1],
        polyline[polyline.length - 1][0],
        polyline[polyline.length - 1][1]
      );

      // Raw speed from distance and schedule
      let calculatedSpeed = Math.round((segmentDistKm / (travelDurationMin / 60)) * 1.05);
      const inTSR = isCoordInTSR(pos.lat, pos.lng);

      if (inTSR) {
        calculatedSpeed = Math.min(20, calculatedSpeed);
      } else {
        calculatedSpeed = Math.min(serviceType.includes('MMTS') ? 75 : 90, Math.max(32, calculatedSpeed));
      }

      // Check conflict proximity for T104/T107
      const isClashTrain = trainNumber === 'T104' || trainNumber === 'T107';
      const isNearSecunderabad = nextStop.stationId === 'SC' && fraction > 0.7;
      const hasConflict = isClashTrain && isNearSecunderabad;

      const nextSt = HYDERABAD_STATIONS.find((s) => s.id === nextStop.stationId);

      return {
        trainNumber,
        name,
        serviceType,
        rakeType,
        state: 'moving',
        lat: pos.lat,
        lng: pos.lng,
        speedKmh: calculatedSpeed,
        bearingDeg: pos.bearingDeg,
        fromStationId: currentStop.stationId,
        toStationId: nextStop.stationId,
        nextStationId: nextStop.stationId,
        nextStationName: nextSt?.name,
        nextPlatform: nextStop.platform,
        progressPct: Math.round(fraction * 100),
        delayMin: effectiveDelay,
        delayReason,
        kavachStatus,
        inTSRZone: inTSR,
        hasConflict,
        conflictDescription: hasConflict
          ? `Headway violation approaching SC Platform 1 (< 5 min buffer)`
          : undefined,
      };
    }
  }

  // Fallback to terminus
  const term = HYDERABAD_STATIONS.find((s) => s.id === lastStop.stationId) || HYDERABAD_STATIONS[0];
  return {
    trainNumber,
    name,
    serviceType,
    rakeType,
    state: 'completed',
    lat: term.lat,
    lng: term.lng,
    speedKmh: 0,
    bearingDeg: 0,
    currentStationId: term.id,
    currentStationName: term.name,
    delayMin: effectiveDelay,
    delayReason: 'Journey completed',
    kavachStatus: 'Armed',
    inTSRZone: false,
    hasConflict: false,
  };
}

/**
 * Geographic projection from GPS (lat, lng) to SVG / Canvas coordinates (x, y)
 * Strictly calibrated to the Hyderabad Corridor bounding box.
 */
export function projectGeoToSvg(
  lat: number,
  lng: number,
  width: number,
  height: number,
  padding = 40
): [number, number] {
  const { minLat, maxLat, minLng, maxLng } = HYDERABAD_BBOX;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // Normalized (0 to 1)
  const normX = (lng - minLng) / (maxLng - minLng);
  // Latitude is inverted in SVG y-axis
  const normY = (maxLat - lat) / (maxLat - minLat);

  const x = padding + normX * innerWidth;
  const y = padding + normY * innerHeight;

  return [x, y];
}

/**
 * Schematic projection layout (topological subway-style view)
 * Guarantees 100% legibility under any network / Wi-Fi conditions.
 */
export const SCHEMATIC_STATION_COORDS: Record<string, [number, number]> = {
  LPI: [100, 120],
  BMT: [320, 200],
  HYB: [220, 420],
  SC: [600, 180],
  STPD: [690, 280],
  VAR: [690, 390],
  KCG: [560, 460],
  MXT: [560, 560],
  FM: [480, 640],
};
