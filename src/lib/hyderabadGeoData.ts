/**
 * Hyderabad Triangle Corridor & MMTS Network Geographic Dataset
 * High-precision WGS84 coordinates & rail alignments for South Central Railway.
 * Real geographic coordinates covering HYB (Nampally), SC (Secunderabad),
 * KCG (Kacheguda), and the MMTS Suburban transit network.
 */

export interface GeoStation {
  id: string;
  code: string;
  name: string;
  localName: string; // Telugu / Hindi name for regional OCC displays
  lat: number;
  lng: number;
  platforms: number;
  isMainline: boolean;
  isMMTS: boolean;
  category: 'major-terminal' | 'junction' | 'suburban-stop';
}

export interface GeoTrackSegment {
  id: string;
  name: string;
  from: string;
  to: string;
  type: 'mainline' | 'mmts' | 'chord';
  lengthKm: number;
  maxSpeedKmh: number;
  coordinates: [number, number][]; // [latitude, longitude] pairs
}

export interface TSRZone {
  id: string;
  code: string;
  trackId: string;
  kmStart: number;
  kmEnd: number;
  speedLimitKmh: number;
  normalSpeedKmh: number;
  cause: string;
  validUntil: string;
  coordinates: [number, number][]; // line segment coordinates
}

// Bounding box strictly enclosing Hyderabad railway network
export const HYDERABAD_BBOX = {
  minLat: 17.315,
  maxLat: 17.505,
  minLng: 78.305,
  maxLng: 78.535,
};

// Major stations & MMTS halts
export const HYDERABAD_STATIONS: GeoStation[] = [
  {
    id: 'HYB',
    code: 'HYB',
    name: 'Hyderabad Deccan (Nampally)',
    localName: 'హైదరాబాద్ డెక్కన్ (నాంపల్లి)',
    lat: 17.3916,
    lng: 78.4695,
    platforms: 4,
    isMainline: true,
    isMMTS: true,
    category: 'major-terminal',
  },
  {
    id: 'SC',
    code: 'SC',
    name: 'Secunderabad Junction',
    localName: 'సికింద్రాబాద్ జంక్షన్',
    lat: 17.4334,
    lng: 78.5017,
    platforms: 6,
    isMainline: true,
    isMMTS: true,
    category: 'major-terminal',
  },
  {
    id: 'KCG',
    code: 'KCG',
    name: 'Kacheguda',
    localName: 'కాచిగూడ',
    lat: 17.3908,
    lng: 78.4983,
    platforms: 3,
    isMainline: true,
    isMMTS: true,
    category: 'major-terminal',
  },
  {
    id: 'BMT',
    code: 'BMT',
    name: 'Begumpet',
    localName: 'బేగంపేట',
    lat: 17.4398,
    lng: 78.4604,
    platforms: 2,
    isMainline: true,
    isMMTS: true,
    category: 'junction',
  },
  {
    id: 'LPI',
    code: 'LPI',
    name: 'Lingampalli',
    localName: 'లింగంపల్లి',
    lat: 17.4875,
    lng: 78.3182,
    platforms: 3,
    isMainline: true,
    isMMTS: true,
    category: 'major-terminal',
  },
  {
    id: 'STPD',
    code: 'STPD',
    name: 'Sitafalmandi',
    localName: 'సీతాఫల్మండి',
    lat: 17.4248,
    lng: 78.5132,
    platforms: 2,
    isMainline: false,
    isMMTS: true,
    category: 'junction',
  },
  {
    id: 'VAR',
    code: 'VAR',
    name: 'Vidyanagar',
    localName: 'విద్యానగర్',
    lat: 17.4026,
    lng: 78.5085,
    platforms: 2,
    isMainline: false,
    isMMTS: true,
    category: 'suburban-stop',
  },
  {
    id: 'MXT',
    code: 'MXT',
    name: 'Malakpet',
    localName: 'మలక్‌పేట',
    lat: 17.3752,
    lng: 78.4962,
    platforms: 2,
    isMainline: false,
    isMMTS: true,
    category: 'suburban-stop',
  },
  {
    id: 'FM',
    code: 'FM',
    name: 'Falaknuma',
    localName: 'ఫలక్‌నుమా',
    lat: 17.3305,
    lng: 78.4735,
    platforms: 3,
    isMainline: false,
    isMMTS: true,
    category: 'major-terminal',
  },
];

// Rail track segments with realistic multi-point geographic alignment
export const HYDERABAD_TRACK_SEGMENTS: GeoTrackSegment[] = [
  // 1. Secunderabad Junction <-> Begumpet <-> Lingampalli (North-West Line)
  {
    id: 'TRACK_SC_BMT',
    name: 'Secunderabad – Begumpet Main Line',
    from: 'SC',
    to: 'BMT',
    type: 'mainline',
    lengthKm: 4.8,
    maxSpeedKmh: 90,
    coordinates: [
      [17.4334, 78.5017], // SC
      [17.4362, 78.4895],
      [17.4385, 78.4742],
      [17.4398, 78.4604], // BMT
    ],
  },
  {
    id: 'TRACK_BMT_LPI',
    name: 'Begumpet – Lingampalli MMTS Fast Line',
    from: 'BMT',
    to: 'LPI',
    type: 'mmts',
    lengthKm: 18.2,
    maxSpeedKmh: 95,
    coordinates: [
      [17.4398, 78.4604], // BMT
      [17.4475, 78.4420], // Sanathnagar
      [17.4580, 78.4120], // Bharatnagar
      [17.4665, 78.3840], // Hitec City
      [17.4780, 78.3520], // Hafeezpet
      [17.4875, 78.3182], // LPI
    ],
  },

  // 2. Begumpet <-> Hyderabad Deccan (Hussain Sagar Chord Line)
  {
    id: 'TRACK_BMT_HYB',
    name: 'Hussain Sagar MMTS Chord to Nampally',
    from: 'BMT',
    to: 'HYB',
    type: 'mmts',
    lengthKm: 6.4,
    maxSpeedKmh: 75,
    coordinates: [
      [17.4398, 78.4604], // BMT
      [17.4265, 78.4628], // Necklace Road
      [17.4120, 78.4650], // Khairatabad
      [17.4010, 78.4670], // Lakdikapul
      [17.3916, 78.4695], // HYB
    ],
  },

  // 3. Secunderabad Junction <-> Hyderabad Deccan (Mainline Corridor)
  {
    id: 'TRACK_SC_HYB',
    name: 'Secunderabad – Hyderabad Deccan Double Line',
    from: 'SC',
    to: 'HYB',
    type: 'mainline',
    lengthKm: 9.6,
    maxSpeedKmh: 80,
    coordinates: [
      [17.4334, 78.5017], // SC
      [17.4285, 78.4870],
      [17.4180, 78.4735], // TSR Zone (KM 11.2 - 11.8)
      [17.4045, 78.4705],
      [17.3916, 78.4695], // HYB
    ],
  },

  // 4. Secunderabad Junction <-> Sitafalmandi <-> Kacheguda (North-South Chord)
  {
    id: 'TRACK_SC_KCG',
    name: 'Secunderabad – Kacheguda Intercity Track',
    from: 'SC',
    to: 'KCG',
    type: 'mainline',
    lengthKm: 7.2,
    maxSpeedKmh: 85,
    coordinates: [
      [17.4334, 78.5017], // SC
      [17.4248, 78.5132], // STPD
      [17.4140, 78.5110], // Jamai Osmania
      [17.4026, 78.5085], // VAR
      [17.3908, 78.4983], // KCG
    ],
  },

  // 5. Hyderabad Deccan <-> Kacheguda (Southern Triangle Connector)
  {
    id: 'TRACK_HYB_KCG',
    name: 'Hyderabad Deccan – Kacheguda Connecting Chord',
    from: 'HYB',
    to: 'KCG',
    type: 'chord',
    lengthKm: 5.1,
    maxSpeedKmh: 65,
    coordinates: [
      [17.3916, 78.4695], // HYB
      [17.3875, 78.4810],
      [17.3892, 78.4910],
      [17.3908, 78.4983], // KCG
    ],
  },

  // 6. Kacheguda <-> Malakpet <-> Falaknuma (MMTS Southern Corridor)
  {
    id: 'TRACK_KCG_FM',
    name: 'Kacheguda – Falaknuma MMTS Suburban Line',
    from: 'KCG',
    to: 'FM',
    type: 'mmts',
    lengthKm: 9.8,
    maxSpeedKmh: 75,
    coordinates: [
      [17.3908, 78.4983], // KCG
      [17.3752, 78.4962], // MXT
      [17.3620, 78.4910], // Dabirpura / Yakutpura
      [17.3465, 78.4830], // Huppuguda
      [17.3305, 78.4735], // FM
    ],
  },
];

// Active Temporary Speed Restriction (TSR-14)
export const ACTIVE_TSR_ZONES: TSRZone[] = [
  {
    id: 'TSR-14',
    code: 'TSR 14/2026',
    trackId: 'TRACK_SC_HYB',
    kmStart: 11.2,
    kmEnd: 11.8,
    speedLimitKmh: 20,
    normalSpeedKmh: 80,
    cause: 'Track maintenance & deep ballast screening',
    validUntil: '18:30 IST',
    coordinates: [
      [17.4205, 78.4760],
      [17.4160, 78.4725],
    ],
  },
];

// Selected Tracked MMTS Trains (Simulated Live)
export interface TrackedMMTSTrain {
  trainNumber: string;
  name: string;
  serviceType: 'MMTS Commuter' | 'Superfast Express' | 'Intercity Express';
  rakeType: '12-Car BEML EMU' | 'LHB Rake (22 Coaches)' | 'ICF Rake';
  originId: string;
  destId: string;
  via: string[];
  stops: {
    stationId: string;
    schedArrMin: number; // minutes from current base 16:00 (e.g. 10 = 16:10)
    schedDepMin: number;
    platform: number;
  }[];
  currentDelayMin: number;
  delayReason: string;
  kavachStatus: 'Active & Supervised' | 'Armed' | 'Cautionary Hold';
}

export const SELECTED_TRACKED_TRAINS: TrackedMMTSTrain[] = [
  // 1. MMTS 47155 (Falaknuma -> Lingampalli)
  {
    trainNumber: '47155',
    name: 'MMTS Falaknuma – Lingampalli',
    serviceType: 'MMTS Commuter',
    rakeType: '12-Car BEML EMU',
    originId: 'FM',
    destId: 'LPI',
    via: ['KCG', 'SC', 'BMT'],
    stops: [
      { stationId: 'FM', schedArrMin: 0, schedDepMin: 5, platform: 1 },
      { stationId: 'MXT', schedArrMin: 14, schedDepMin: 15, platform: 2 },
      { stationId: 'KCG', schedArrMin: 21, schedDepMin: 23, platform: 2 },
      { stationId: 'VAR', schedArrMin: 28, schedDepMin: 29, platform: 1 },
      { stationId: 'STPD', schedArrMin: 34, schedDepMin: 35, platform: 2 },
      { stationId: 'SC', schedArrMin: 42, schedDepMin: 45, platform: 4 },
      { stationId: 'BMT', schedArrMin: 55, schedDepMin: 57, platform: 2 },
      { stationId: 'LPI', schedArrMin: 85, schedDepMin: 90, platform: 3 },
    ],
    currentDelayMin: 0,
    delayReason: 'On-time corridor run under Kavach supervision',
    kavachStatus: 'Active & Supervised',
  },

  // 2. MMTS 47178 (Hyderabad Deccan -> Lingampalli)
  {
    trainNumber: '47178',
    name: 'MMTS Hyderabad – Lingampalli',
    serviceType: 'MMTS Commuter',
    rakeType: '12-Car BEML EMU',
    originId: 'HYB',
    destId: 'LPI',
    via: ['BMT'],
    stops: [
      { stationId: 'HYB', schedArrMin: 5, schedDepMin: 12, platform: 3 },
      { stationId: 'BMT', schedArrMin: 24, schedDepMin: 26, platform: 1 },
      { stationId: 'LPI', schedArrMin: 54, schedDepMin: 60, platform: 2 },
    ],
    currentDelayMin: 2,
    delayReason: 'Slow clearance at Lakdikapul interlock',
    kavachStatus: 'Active & Supervised',
  },

  // 3. MMTS 47182 (Lingampalli -> Hyderabad Deccan)
  {
    trainNumber: '47182',
    name: 'MMTS Lingampalli – Hyderabad',
    serviceType: 'MMTS Commuter',
    rakeType: '12-Car BEML EMU',
    originId: 'LPI',
    destId: 'HYB',
    via: ['BMT'],
    stops: [
      { stationId: 'LPI', schedArrMin: 15, schedDepMin: 20, platform: 1 },
      { stationId: 'BMT', schedArrMin: 48, schedDepMin: 50, platform: 2 },
      { stationId: 'HYB', schedArrMin: 62, schedDepMin: 68, platform: 2 },
    ],
    currentDelayMin: 0,
    delayReason: 'Clear block signals throughout',
    kavachStatus: 'Active & Supervised',
  },

  // 4. MMTS 47101 (Falaknuma -> Secunderabad Junction)
  {
    trainNumber: '47101',
    name: 'MMTS Falaknuma – Secunderabad',
    serviceType: 'MMTS Commuter',
    rakeType: '12-Car BEML EMU',
    originId: 'FM',
    destId: 'SC',
    via: ['KCG', 'VAR', 'STPD'],
    stops: [
      { stationId: 'FM', schedArrMin: 20, schedDepMin: 25, platform: 2 },
      { stationId: 'KCG', schedArrMin: 38, schedDepMin: 40, platform: 3 },
      { stationId: 'SC', schedArrMin: 56, schedDepMin: 62, platform: 5 },
    ],
    currentDelayMin: 4,
    delayReason: 'Held for priority express clearance at Sitafalmandi',
    kavachStatus: 'Armed',
  },

  // 5. Mainline Express 12723 (Telangana Superfast Express: HYB -> NDLS)
  {
    trainNumber: '12723',
    name: 'Telangana Express',
    serviceType: 'Superfast Express',
    rakeType: 'LHB Rake (22 Coaches)',
    originId: 'HYB',
    destId: 'SC',
    via: ['SC'],
    stops: [
      { stationId: 'HYB', schedArrMin: 10, schedDepMin: 25, platform: 1 },
      { stationId: 'SC', schedArrMin: 45, schedDepMin: 55, platform: 2 },
    ],
    currentDelayMin: 0,
    delayReason: 'Pre-departure brake test & Kavach check verified',
    kavachStatus: 'Active & Supervised',
  },

  // 6. Mainline Express 12727 (Godavari Express)
  {
    trainNumber: '12727',
    name: 'Godavari Express',
    serviceType: 'Intercity Express',
    rakeType: 'LHB Rake (22 Coaches)',
    originId: 'HYB',
    destId: 'SC',
    via: ['SC'],
    stops: [
      { stationId: 'HYB', schedArrMin: 20, schedDepMin: 35, platform: 4 },
      { stationId: 'SC', schedArrMin: 55, schedDepMin: 65, platform: 3 },
    ],
    currentDelayMin: 10,
    delayReason: 'Late platform placement at Hyderabad pit line',
    kavachStatus: 'Active & Supervised',
  },

  // 7. T104 (Godavari Incoming Rake - Critical Platform 1 Conflict at SC)
  {
    trainNumber: 'T104',
    name: 'Godavari Rake Incoming',
    serviceType: 'Intercity Express',
    rakeType: 'ICF Rake',
    originId: 'HYB',
    destId: 'SC',
    via: ['SC'],
    stops: [
      { stationId: 'HYB', schedArrMin: 0, schedDepMin: 10, platform: 2 },
      { stationId: 'SC', schedArrMin: 30, schedDepMin: 45, platform: 1 }, // CLASH with T107 on PF 1
    ],
    currentDelayMin: 5,
    delayReason: 'Speed reduced across TSR-14 restriction zone',
    kavachStatus: 'Cautionary Hold',
  },

  // 8. T107 (Charminar Rake Incoming - Critical Platform 1 Conflict at SC)
  {
    trainNumber: 'T107',
    name: 'Charminar Rake Incoming',
    serviceType: 'Superfast Express',
    rakeType: 'LHB Rake (22 Coaches)',
    originId: 'KCG',
    destId: 'SC',
    via: ['SC'],
    stops: [
      { stationId: 'KCG', schedArrMin: 5, schedDepMin: 15, platform: 1 },
      { stationId: 'SC', schedArrMin: 33, schedDepMin: 48, platform: 1 }, // CLASH with T104 on PF 1 (gap = 3m < 5m)
    ],
    currentDelayMin: 0,
    delayReason: 'Approaching Secunderabad outer signal; headway clash detected',
    kavachStatus: 'Cautionary Hold',
  },
];

export const TRACKED_MMTS_TRAINS = SELECTED_TRACKED_TRAINS;
