/*
 * ElectricSound garage: specs, drivetrain, sound model and silhouette for every car.
 */
(function () {
  'use strict';

  // Turn a firing order into each cylinder's position in the 720-degree cycle.
  function fire(order, bankOf, intervals) {
    var n = order.length, offsets = new Array(n), bank = new Array(n), ang = 0;
    order.forEach(function (cyl, k) {
      offsets[cyl - 1] = ang / 720;
      bank[cyl - 1] = bankOf(cyl);
      ang += intervals ? intervals[k % intervals.length] : 720 / n;
    });
    return { offsets: offsets, bank: bank };
  }
  var oddEven = function (c) { return c % 2 ? 0 : 1; };
  var half = function (n) { return function (c) { return c <= n ? 0 : 1; }; };

  var FLAT6 = fire([1, 6, 2, 4, 3, 5], half(3));
  var V8_CROSS_GM = fire([1, 8, 7, 2, 6, 5, 4, 3], oddEven);
  var V8_HEMI = fire([1, 8, 4, 3, 6, 5, 7, 2], oddEven);
  var V8_HOTV = fire([1, 5, 4, 8, 6, 3, 7, 2], half(4));
  var V10 = fire([1, 6, 5, 10, 2, 7, 3, 8, 4, 9], half(5));
  var V12_65 = fire([1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10], half(6), [65, 55]);
  var V12_60 = fire([1, 12, 4, 9, 2, 11, 6, 7, 3, 10, 5, 8], half(6));
  var V6 = fire([1, 2, 3, 4, 5, 6], oddEven);
  var V6_SINGLE = fire([1, 4, 2, 5, 3, 6], function () { return 0; });
  var I6 = fire([1, 5, 3, 6, 2, 4], half(3));
  var W16 = fire([1, 14, 9, 4, 7, 12, 15, 6, 13, 8, 3, 16, 11, 2, 5, 10], half(8));

  function ice(layout, redline, o) {
    var base = {
      type: 'ice', redline: redline, offsets: layout.offsets, bank: layout.bank,
      pulseMs: 2.6, header: [1.1, 0.3], pipe: [9, 0.42], loopHz: 2400, xmix: 0.25,
      muffle: [500, 4200], formants: [[180, 2, 0.8], [520, 2.5, 0.5], [1400, 3, 0.3]],
      noise: 0.35, drive: 1.6, jitter: 0.08, lope: 0, intake: 0.25, intakeHz: 500,
      turbo: 0, sc: 0, pops: 0.4, offLoad: 0.22, pan: 0.2
    };
    for (var k in o) base[k] = o[k];
    return base;
  }
  function ev(redline, o) {
    var base = { type: 'ev', redline: redline, f0: 80, span: 1200, curve: 0.8, harm: [0.6, 0.3, 0.15, 0.08], sub: 0.3, buzz: 0.6, idleAmp: 0.15, regen: 0.2, thrusters: 0 };
    for (var k in o) base[k] = o[k];
    return base;
  }

  var WING_911 = [[[905, 168], [925, 168], [940, 236], [925, 236]], [[866, 236], [992, 246], [994, 258], [866, 247]]];

  var CARS = [
    {
      id: 'gt3', name: 'Porsche 911 GT3', tag: 'Flat-six · naturally aspirated', color: '#3a9bff',
      line: '4.0 L flat-six · 9,000 rpm · 7-speed PDK',
      specs: { Engine: '4.0 L flat-six', Exhaust: 'Lightweight stainless sport exhaust, twin centre tailpipes', Power: '502 hp', Redline: '9,000 rpm', Gearbox: '7-speed PDK dual-clutch' },
      drive: { idle: 950, redline: 9000, gears: [77, 132, 178, 221, 264, 304, 340], shift: 0.08, box: 'dct', acc: 9.5, pw: 261, revUp: 15000, revDown: 7500 },
      sound: ice(FLAT6, 9000, { pulseMs: 1.5, header: [0.8, 0.3], pipe: [5.5, 0.45], loopHz: 3400, muffle: [900, 7500], formants: [[420, 3, 0.9], [1100, 4, 0.8], [2600, 4, 0.5]], noise: 0.3, drive: 2.0, jitter: 0.05, intake: 0.5, intakeHz: 700, pops: 0.35 }),
      shape: { yb: 40, wheels: [222, 760], r: 75,
        top: [[14, 40], [8, 80], [26, 122], [110, 158], [215, 180], [320, 190], [440, 258], [530, 278], [625, 268], [760, 222], [880, 180], [965, 158], [990, 128, 1], [988, 40]],
        win: [[338, 193, 1], [445, 248], [530, 264], [618, 254], [700, 216, 1], [600, 196]], extra: WING_911 }
    },
    {
      id: 'huracan', name: 'Lamborghini Huracán', tag: 'V10 · naturally aspirated', color: '#7ad52b',
      line: '5.2 L V10 · 8,500 rpm · 7-speed dual-clutch',
      specs: { Engine: '5.2 L V10, 90° even-fire', Aspiration: 'Naturally aspirated', Exhaust: 'Sport exhaust with active flaps, twin high-mounted tailpipes', Power: '631 hp', Redline: '8,500 rpm', Gearbox: '7-speed dual-clutch' },
      drive: { idle: 1000, redline: 8500, gears: [85, 128, 172, 217, 262, 305, 345], shift: 0.08, box: 'dct', acc: 10.5, pw: 330, revUp: 15000, revDown: 8000 },
      sound: ice(V10, 8500, { pulseMs: 1.6, header: [0.85, 0.32], pipe: [5, 0.45], loopHz: 3400, muffle: [900, 8000], formants: [[480, 3, 0.9], [1250, 4, 0.9], [3000, 4, 0.5]], drive: 2.2, jitter: 0.05, intake: 0.4, intakeHz: 650, pops: 0.7 }),
      shape: { yb: 38, wheels: [215, 790], r: 76,
        top: [[10, 38], [4, 70, 1], [70, 108], [200, 140], [320, 168], [455, 238], [540, 252], [630, 240], [780, 196], [920, 176], [988, 168, 1], [994, 110], [978, 38]],
        win: [[340, 172, 1], [458, 228], [540, 240], [625, 228], [690, 194, 1], [560, 178]] }
    },
    {
      id: 'roadster', name: 'Tesla Roadster', tag: 'Electric · cold-gas thrusters', color: '#ff5a3c',
      line: 'Tri-motor electric · thrusters on hard launches',
      specs: { Engine: 'Three electric motors (announced)', Aspiration: 'Battery electric, 200 kWh pack', Exhaust: 'None. Cold-gas thrusters fire on full throttle', Power: 'Over 1,000 hp (claimed)', Redline: '18,000 rpm motor speed', Gearbox: 'Single-speed' },
      drive: { idle: 0, redline: 18000, gears: [410], shift: 0, box: 'ev', acc: 13.5, pw: 500, revUp: 30000, revDown: 22000 },
      sound: ev(18000, { f0: 110, span: 2300, curve: 0.8, harm: [0.5, 0.3, 0.16, 0.14], sub: 0.2, buzz: 0.5, idleAmp: 0.12, regen: 0.35, thrusters: 0.5 }),
      shape: { yb: 38, wheels: [205, 792], r: 77, aero: true,
        top: [[12, 38], [6, 84], [50, 122], [170, 152], [320, 178], [440, 236], [540, 254], [650, 244], [790, 208], [910, 182], [978, 172, 1], [992, 120], [980, 38]],
        win: [[338, 182, 1], [445, 226], [540, 242], [645, 232], [730, 202, 1], [560, 186]] }
    },
    {
      id: 'screamer', name: 'Ten-Speed Screamer', tag: 'Flat-six · ten short gears', color: '#c6f135',
      line: 'Flat-six howl · 9,000 rpm · 10 short gears · all done by 120 km/h',
      specs: { Engine: '3.6 L flat-six (ElectricSound original)', Aspiration: 'Naturally aspirated', Exhaust: 'Straight-through twin pipes, no silencers', Power: '380 hp', Redline: '9,000 rpm', Gearbox: '10-speed close-ratio. Runs out of gears at 120 km/h, so it shifts constantly in town' },
      drive: { idle: 1000, redline: 9000, gears: [14, 22, 31, 41, 52, 64, 77, 91, 105, 120], shift: 0.06, box: 'dct', acc: 6.5, pw: 150, revUp: 17000, revDown: 9000 },
      sound: ice(FLAT6, 9000, { pulseMs: 1.3, header: [0.7, 0.32], pipe: [4.6, 0.48], loopHz: 3800, muffle: [1000, 8500], formants: [[460, 3, 0.9], [1250, 4, 0.9], [2900, 4, 0.55]], noise: 0.34, drive: 2.3, jitter: 0.05, intake: 0.45, intakeHz: 760, pops: 0.6 }),
      shape: { yb: 46, wheels: [195, 785], r: 72,
        top: [[12, 46], [6, 105], [36, 150], [190, 184], [320, 198], [420, 280], [510, 300], [740, 296], [838, 290, 1], [895, 220], [975, 196], [992, 150], [984, 46]],
        win: [[336, 203, 1], [426, 270], [512, 287], [735, 283], [812, 214, 1], [600, 204]] }
    },
    {
      id: 'muscle', name: 'Classic V8 Muscle', tag: 'Crossplane V8 · big cam', color: '#22b8f0',
      line: '6.2 L crossplane V8 · 6-speed manual · true dual exhaust',
      specs: { Engine: '6.2 L crossplane V8 (378 cu in)', Aspiration: 'Naturally aspirated, lumpy cam', Exhaust: 'True dual 2.5-inch pipes with H-pipe and chambered mufflers', Power: '455 hp', Redline: '6,500 rpm', Gearbox: '6-speed manual' },
      drive: { idle: 780, redline: 6500, gears: [80, 120, 170, 225, 290, 380], shift: 0.36, box: 'manual', acc: 6.5, pw: 200, revUp: 9000, revDown: 4200 },
      sound: ice(V8_CROSS_GM, 6500, { pulseMs: 3.4, header: [1.6, 0.35], pipe: [12, 0.5], loopHz: 1700, xmix: 0.1, muffle: [350, 2600], formants: [[95, 2, 1.2], [210, 2.5, 0.9], [480, 2.5, 0.5]], noise: 0.5, drive: 1.8, jitter: 0.14, lope: 0.5, intake: 0.2, intakeHz: 300, pops: 0.3, pan: 0.3 }),
      shape: { yb: 52, wheels: [188, 768], r: 72,
        top: [[8, 52], [4, 150, 1], [40, 170], [320, 180], [392, 186], [462, 258], [550, 270], [650, 262], [850, 192], [960, 184], [992, 176, 1], [994, 100], [984, 52]],
        win: [[406, 190, 1], [468, 246], [552, 256], [645, 248], [760, 200, 1], [600, 190]] }
    },
    {
      id: 'f812', name: 'Ferrari 812 Superfast', tag: 'V12 · naturally aspirated', color: '#e0202c',
      line: '6.5 L V12 · 8,900 rpm · 7-speed dual-clutch',
      specs: { Engine: '6.5 L V12, 65°', Aspiration: 'Naturally aspirated', Exhaust: 'Equal-length 6-into-1 headers, quad tailpipes', Power: '789 hp', Redline: '8,900 rpm', Gearbox: '7-speed dual-clutch' },
      drive: { idle: 1000, redline: 8900, gears: [92, 140, 185, 232, 280, 325, 370], shift: 0.07, box: 'dct', acc: 9.8, pw: 360, revUp: 16000, revDown: 8500 },
      sound: ice(V12_65, 8900, { pulseMs: 1.4, header: [0.8, 0.3], pipe: [6.5, 0.42], loopHz: 3600, muffle: [900, 8500], formants: [[520, 3, 0.8], [1400, 4, 0.9], [3200, 4, 0.55]], drive: 1.9, jitter: 0.04, intake: 0.45, intakeHz: 800, pops: 0.4 }),
      shape: { yb: 38, wheels: [205, 790], r: 76,
        top: [[12, 38], [5, 88], [44, 128], [190, 162], [380, 186], [432, 194], [538, 260], [622, 274], [715, 262], [858, 216], [950, 196], [990, 186, 1], [994, 116], [980, 38]],
        win: [[446, 198, 1], [544, 248], [624, 260], [712, 248], [790, 212, 1], [640, 198]] }
    },
    {
      id: 'hellcat', name: 'Dodge Hellcat', tag: 'Supercharged V8', color: '#a35cff',
      line: '6.2 L supercharged V8 · 6,200 rpm · 6-speed manual',
      specs: { Engine: '6.2 L HEMI V8', Aspiration: '2.4 L twin-screw supercharger', Exhaust: '2.75-inch straight-through duals with active valves', Power: '717 hp', Redline: '6,200 rpm', Gearbox: '6-speed manual' },
      drive: { idle: 800, redline: 6200, gears: [90, 130, 185, 245, 320, 400], shift: 0.34, box: 'manual', acc: 7.2, pw: 265, revUp: 9500, revDown: 4500 },
      sound: ice(V8_HEMI, 6200, { pulseMs: 3.2, header: [1.5, 0.35], pipe: [11, 0.5], loopHz: 1800, xmix: 0.15, muffle: [380, 3000], formants: [[105, 2, 1.2], [240, 2.5, 0.9], [560, 2.5, 0.55]], noise: 0.5, drive: 2.0, jitter: 0.12, lope: 0.35, intake: 0.2, intakeHz: 320, sc: 0.9, pops: 0.45, pan: 0.3 }),
      shape: { yb: 50, wheels: [185, 772], r: 73,
        top: [[8, 50], [4, 158, 1], [34, 182], [320, 194], [388, 200], [466, 276], [556, 289], [696, 284], [796, 236], [856, 210], [980, 202], [996, 192, 1], [996, 104], [986, 50]],
        win: [[400, 205, 1], [472, 264], [558, 275], [688, 270], [768, 226, 1], [640, 206]],
        extra: [[[900, 204], [994, 206], [996, 218], [904, 213]]] }
    },
    {
      id: 'evhum', name: 'Volt Hum', tag: 'Electric · synth drone', color: '#ff5fd2',
      line: 'Electric buzz · deep when slow, bright when fast · near-silent regen',
      specs: { Engine: 'Dual-motor electric (ElectricSound original)', Aspiration: 'Battery electric', Exhaust: 'None. A synthesised motor hum that climbs with speed', Power: '670 hp', Redline: '16,000 rpm motor speed', Gearbox: 'Single-speed' },
      drive: { idle: 0, redline: 16000, gears: [250], shift: 0, box: 'ev', acc: 9, pw: 300, revUp: 26000, revDown: 20000 },
      sound: ev(16000, { f0: 60, span: 620, curve: 0.75, harm: [0.8, 0.25, 0.1, 0.03], sub: 0.5, buzz: 0.9, idleAmp: 0.18, regen: 0.08, thrusters: 0 }),
      shape: { yb: 40, wheels: [190, 800], r: 76, aero: true,
        top: [[12, 40], [6, 92], [60, 138], [220, 186], [410, 262], [540, 276], [700, 258], [880, 202], [980, 164, 1], [994, 112], [980, 40]],
        win: [[262, 196, 1], [414, 250], [540, 263], [692, 246], [830, 204, 1], [560, 192]] }
    },
    {
      id: 'urus', name: 'Lamborghini Urus', tag: 'Twin-turbo V8 · SUV', color: '#f7c21a',
      line: '4.0 L twin-turbo V8 · 6,800 rpm · 8-speed automatic',
      specs: { Engine: '4.0 L V8, hot-vee', Aspiration: 'Twin-turbocharged', Exhaust: 'Active-valve sport exhaust, quad tailpipes', Power: '641 hp', Redline: '6,800 rpm', Gearbox: '8-speed automatic' },
      drive: { idle: 800, redline: 6800, gears: [60, 95, 140, 185, 235, 290, 350, 420], shift: 0.2, box: 'auto', acc: 8.6, pw: 217, revUp: 10500, revDown: 5500 },
      sound: ice(V8_HOTV, 6800, { pulseMs: 2.8, header: [1.3, 0.32], pipe: [10, 0.45], loopHz: 2000, xmix: 0.35, muffle: [380, 3200], formants: [[130, 2, 1.0], [300, 2.5, 0.8], [700, 3, 0.4]], noise: 0.45, drive: 1.8, jitter: 0.08, turbo: 0.6, pops: 0.8 }),
      shape: { yb: 68, wheels: [190, 778], r: 82,
        top: [[10, 68], [5, 150], [40, 196], [240, 226], [326, 236], [436, 308], [540, 320], [700, 312], [856, 268], [930, 238], [984, 218, 1], [995, 144], [986, 68]],
        win: [[340, 241, 1], [442, 296], [540, 307], [694, 299], [812, 262], [836, 240, 1], [600, 236]] }
    },
    {
      id: 'gp', name: 'Grand Prix Hybrid', tag: 'Turbo V6 hybrid · open-wheel', color: '#2de0d0',
      line: '1.6 L turbo V6 hybrid · 12,000 rpm · 8-speed seamless',
      specs: { Engine: '1.6 L V6 hybrid (ElectricSound original)', Aspiration: 'Single turbo with electric assist', Exhaust: 'Single centre exit with wastegate pipe', Power: 'About 1,000 hp', Redline: '12,000 rpm', Gearbox: '8-speed seamless shift' },
      drive: { idle: 3500, redline: 12000, gears: [110, 145, 180, 215, 250, 285, 318, 350], shift: 0.03, box: 'seamless', acc: 12, pw: 900, revUp: 30000, revDown: 16000 },
      sound: ice(V6_SINGLE, 12000, { pulseMs: 1.0, header: [0.6, 0.3], pipe: [3.2, 0.4], loopHz: 4200, muffle: [1100, 9000], formants: [[700, 3, 0.8], [1800, 4, 0.8], [3600, 4, 0.5]], noise: 0.3, drive: 2.2, jitter: 0.04, intake: 0.3, intakeHz: 1000, turbo: 0.8, pops: 0.2 }),
      shape: { yb: 20, wheels: [165, 800], r: 66, open: true,
        top: [[100, 20], [20, 34, 1], [90, 58], [230, 84], [350, 100], [400, 112], [430, 150, 1], [470, 172], [530, 174], [620, 150], [740, 112], [860, 84], [930, 60], [940, 20]],
        extra: [[[0, 14], [112, 14], [112, 28], [40, 34], [0, 46]], [[902, 40], [990, 40], [996, 190], [905, 190]], [[330, 100], [395, 130], [440, 152], [440, 141], [400, 120], [345, 96]]] }
    },
    {
      id: 'enzo', name: 'Ferrari Enzo', tag: 'V12 · naturally aspirated', color: '#ffd84a',
      line: '6.0 L V12 · 8,200 rpm · 6-speed paddle shift',
      specs: { Engine: '6.0 L V12, 65°', Aspiration: 'Naturally aspirated', Exhaust: 'Equal-length headers, bypass-valve silencers, quad tailpipes', Power: '651 hp', Redline: '8,200 rpm', Gearbox: '6-speed automated manual' },
      drive: { idle: 1000, redline: 8200, gears: [95, 145, 190, 240, 295, 355], shift: 0.15, box: 'single', acc: 8.5, pw: 355, revUp: 16000, revDown: 8500 },
      sound: ice(V12_65, 8200, { pulseMs: 1.5, header: [0.8, 0.32], pipe: [5.8, 0.46], loopHz: 3600, muffle: [850, 8000], formants: [[560, 3, 0.9], [1500, 4.5, 1.0], [3400, 4, 0.5]], drive: 2.1, jitter: 0.05, intake: 0.4, intakeHz: 780, pops: 0.3 }),
      shape: { yb: 36, wheels: [222, 786], r: 76,
        top: [[10, 36], [2, 66, 1], [80, 104], [220, 142], [296, 160], [420, 232], [498, 244], [596, 234], [756, 192], [900, 174], [986, 170, 1], [995, 112], [978, 36]],
        win: [[312, 164, 1], [424, 222], [500, 232], [588, 222], [640, 188, 1], [500, 170]] }
    },
    {
      id: 'veneno', name: 'Lamborghini Veneno', tag: 'V12 · naturally aspirated', color: '#d4d7dc',
      line: '6.5 L V12 · 8,500 rpm · 7-speed single-clutch',
      specs: { Engine: '6.5 L V12, 60°', Aspiration: 'Naturally aspirated', Exhaust: 'Lightweight race-style exhaust, four centre outlets', Power: '740 hp', Redline: '8,500 rpm', Gearbox: '7-speed ISR single-clutch' },
      drive: { idle: 1000, redline: 8500, gears: [85, 125, 170, 215, 262, 310, 360], shift: 0.13, box: 'single', acc: 10.2, pw: 370, revUp: 15500, revDown: 8000 },
      sound: ice(V12_60, 8500, { pulseMs: 1.6, header: [0.85, 0.34], pipe: [6.2, 0.48], loopHz: 3300, muffle: [800, 7500], formants: [[440, 3, 1.0], [1150, 4, 0.9], [2700, 4, 0.5]], noise: 0.45, drive: 2.4, jitter: 0.05, intake: 0.4, intakeHz: 700, pops: 0.9 }),
      shape: { yb: 34, wheels: [215, 765], r: 76,
        top: [[8, 34], [0, 58, 1], [90, 98], [250, 134], [336, 154], [462, 222], [536, 232], [636, 220], [796, 182], [926, 166], [984, 152, 1], [992, 100], [972, 34]],
        win: [[350, 158, 1], [466, 212], [538, 220], [628, 208], [676, 178, 1], [540, 164]],
        extra: [[[560, 230], [900, 214], [905, 170], [700, 196]], [[872, 224], [1000, 236], [1000, 250], [872, 236]], [[930, 158], [955, 158], [965, 228], [945, 228]]] }
    },
    {
      id: 'rs6', name: 'Audi RS 6 Avant (C8)', tag: 'Twin-turbo V8 · wagon', color: '#9fb0c4',
      line: '4.0 L twin-turbo V8 · 6,800 rpm · 8-speed automatic',
      specs: { Engine: '4.0 L V8, hot-vee, mild hybrid', Aspiration: 'Twin-turbocharged', Exhaust: 'RS sport exhaust with flaps, twin oval tailpipes', Power: '591 hp', Redline: '6,800 rpm', Gearbox: '8-speed tiptronic automatic' },
      drive: { idle: 780, redline: 6800, gears: [58, 92, 135, 180, 230, 285, 345, 415], shift: 0.2, box: 'auto', acc: 8.4, pw: 212, revUp: 10500, revDown: 5500 },
      sound: ice(V8_HOTV, 6800, { pulseMs: 2.9, header: [1.35, 0.32], pipe: [10.5, 0.45], loopHz: 1900, xmix: 0.4, muffle: [340, 2800], formants: [[120, 2, 1.1], [280, 2.5, 0.8], [640, 3, 0.4]], noise: 0.45, drive: 1.7, jitter: 0.08, turbo: 0.5, pops: 0.6 }),
      shape: { yb: 50, wheels: [185, 772], r: 77,
        top: [[10, 50], [5, 130], [40, 176], [250, 200], [336, 208], [436, 282], [540, 294], [830, 286], [896, 280, 1], [936, 216], [984, 196], [995, 124], [986, 50]],
        win: [[350, 213, 1], [442, 271], [540, 281], [826, 273], [884, 222, 1], [600, 212]] }
    },
    {
      id: 'gtr', name: 'Nissan GT-R NISMO (R35)', tag: 'Twin-turbo V6', color: '#2f6bff',
      line: '3.8 L twin-turbo V6 · 7,100 rpm · 6-speed dual-clutch',
      specs: { Engine: '3.8 L V6 (VR38DETT), hand-built', Aspiration: 'Twin-turbocharged', Exhaust: 'Titanium exhaust, quad tailpipes', Power: '600 hp', Redline: '7,100 rpm', Gearbox: '6-speed dual-clutch' },
      drive: { idle: 850, redline: 7100, gears: [65, 105, 150, 200, 260, 330], shift: 0.1, box: 'dct', acc: 10.4, pw: 256, revUp: 12500, revDown: 6500 },
      sound: ice(V6, 7100, { pulseMs: 2.2, header: [1.0, 0.3], pipe: [8, 0.42], loopHz: 2600, muffle: [500, 4200], formants: [[240, 2.5, 0.9], [620, 3, 0.8], [1500, 3, 0.4]], drive: 1.9, jitter: 0.07, intake: 0.3, intakeHz: 520, turbo: 0.85, pops: 0.4 }),
      shape: { yb: 46, wheels: [200, 792], r: 75,
        top: [[10, 46], [4, 112], [40, 152], [230, 186], [356, 200], [446, 276], [528, 291], [650, 286], [764, 244], [850, 206], [978, 198], [995, 188, 1], [995, 106], [984, 46]],
        win: [[370, 205, 1], [452, 264], [530, 278], [640, 273], [735, 236], [756, 206, 1], [560, 204]],
        extra: [[[872, 246], [996, 252], [996, 264], [872, 256]], [[905, 198], [925, 198], [935, 250], [918, 250]]] }
    },
    {
      id: 'chiron', name: 'Bugatti Chiron', tag: 'Quad-turbo W16', color: '#ff3355',
      line: '8.0 L quad-turbo W16 · 6,700 rpm · 7-speed dual-clutch',
      specs: { Engine: '8.0 L W16', Aspiration: 'Four turbochargers, two-stage', Exhaust: 'Titanium exhaust with six catalytic converters, centre outlets', Power: '1,479 hp', Redline: '6,700 rpm', Gearbox: '7-speed dual-clutch' },
      drive: { idle: 750, redline: 6700, gears: [98, 150, 205, 265, 330, 395, 460], shift: 0.09, box: 'dct', acc: 11.8, pw: 552, revUp: 11000, revDown: 5500 },
      sound: ice(W16, 6700, { pulseMs: 2.6, header: [1.3, 0.32], pipe: [10, 0.45], loopHz: 2000, xmix: 0.3, muffle: [320, 3000], formants: [[110, 2, 1.1], [260, 2.5, 0.9], [600, 3, 0.5]], noise: 0.55, drive: 1.8, jitter: 0.06, intake: 0.35, intakeHz: 420, turbo: 1.0, pops: 0.3 }),
      shape: { yb: 38, wheels: [205, 800], r: 78,
        top: [[10, 38], [4, 100], [44, 142], [200, 174], [326, 194], [446, 256], [540, 267], [650, 256], [800, 216], [940, 190], [990, 170, 1], [996, 112], [980, 38]],
        win: [[342, 198, 1], [452, 246], [544, 255], [640, 242], [700, 200, 1], [560, 196]] }
    },
    {
      id: 'turbos', name: 'Porsche 911 Turbo S (992)', tag: 'Twin-turbo flat-six', color: '#ff6a2b',
      line: '3.7 L twin-turbo flat-six · 7,200 rpm · 8-speed PDK',
      specs: { Engine: '3.7 L flat-six', Aspiration: 'Twin variable-geometry turbochargers', Exhaust: 'Sport exhaust with flaps, twin oval tailpipes', Power: '640 hp', Redline: '7,200 rpm', Gearbox: '8-speed PDK dual-clutch' },
      drive: { idle: 850, redline: 7200, gears: [65, 105, 150, 195, 245, 300, 360, 430], shift: 0.08, box: 'dct', acc: 11.5, pw: 291, revUp: 13000, revDown: 6500 },
      sound: ice(FLAT6, 7200, { pulseMs: 2.0, header: [0.95, 0.3], pipe: [7, 0.42], loopHz: 2800, muffle: [550, 4500], formants: [[300, 2.5, 0.9], [760, 3, 0.8], [1800, 3.5, 0.4]], drive: 1.9, jitter: 0.06, intake: 0.3, intakeHz: 560, turbo: 0.8, pops: 0.35 }),
      shape: { yb: 40, wheels: [222, 760], r: 75,
        top: [[14, 40], [8, 80], [26, 122], [110, 158], [215, 180], [320, 190], [440, 258], [530, 278], [625, 268], [760, 222], [880, 182], [955, 170], [990, 164, 1], [992, 120], [988, 40]],
        win: [[338, 193, 1], [445, 248], [530, 264], [618, 254], [700, 216, 1], [600, 196]],
        extra: [[[896, 186], [992, 198], [994, 208], [896, 195]], [[920, 174], [940, 172], [946, 192], [926, 190]]] }
    },
    {
      id: 'm3', name: 'BMW M3 Competition (G80)', tag: 'Twin-turbo inline-six', color: '#1faf6e',
      line: '3.0 L twin-turbo inline-six · 7,200 rpm · 8-speed automatic',
      specs: { Engine: '3.0 L inline-six (S58)', Aspiration: 'Twin mono-scroll turbochargers', Exhaust: 'M Sport exhaust with electric flaps, quad tailpipes', Power: '503 hp', Redline: '7,200 rpm', Gearbox: '8-speed M Steptronic automatic' },
      drive: { idle: 800, redline: 7200, gears: [58, 90, 135, 180, 230, 285, 345, 410], shift: 0.16, box: 'auto', acc: 8.0, pw: 217, revUp: 12500, revDown: 6500 },
      sound: ice(I6, 7200, { pulseMs: 2.0, header: [1.0, 0.3], pipe: [8.5, 0.44], loopHz: 2700, xmix: 0.4, muffle: [480, 4400], formants: [[260, 2.5, 0.9], [680, 3, 0.9], [1700, 3.5, 0.45]], drive: 2.0, jitter: 0.06, intake: 0.3, intakeHz: 540, turbo: 0.55, pops: 0.75 }),
      shape: { yb: 50, wheels: [180, 776], r: 74,
        top: [[10, 50], [4, 130], [36, 178], [250, 200], [346, 208], [446, 286], [540, 299], [680, 292], [800, 246], [852, 224], [972, 216], [995, 206, 1], [996, 112], [986, 50]],
        win: [[360, 213, 1], [452, 275], [540, 286], [674, 280], [770, 238], [790, 214, 1], [580, 212]] }
    }
  ];

  // ---------------------------------------------------------------- silhouettes
  var GROUND = 340;
  function f(n) { return Math.round(n * 10) / 10; }

  // Catmull-Rom through points given as [x, yUp, sharp?]; returns the "C..." tail of a path.
  function spline(pts, closed) {
    var n = pts.length, d = '';
    function at(i) { return closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]; }
    function tan(i) {
      var p = at(i);
      if (p[2] || (!closed && (i === 0 || i === n - 1))) return [0, 0];
      var a = at(i - 1), b = at(i + 1);
      return [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
    }
    var segs = closed ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var p1 = at(i), p2 = at(i + 1), t1 = tan(i), t2 = tan(i + 1);
      d += 'C' + f(p1[0] + t1[0]) + ' ' + f(GROUND - (p1[1] + t1[1])) + ' ' + f(p2[0] - t2[0]) + ' ' + f(GROUND - (p2[1] - t2[1])) + ' ' + f(p2[0]) + ' ' + f(GROUND - p2[1]);
    }
    return d;
  }
  function circle(cx, cy, r) {
    return 'M' + f(cx - r) + ' ' + f(cy) + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0Z';
  }

  function build(shape) {
    var top = shape.top, yb = shape.yb, r = shape.r, A = r + 10;
    var body = 'M' + f(top[0][0]) + ' ' + f(GROUND - top[0][1]) + spline(top, false);
    var Yb = f(GROUND - yb);
    if (!shape.open) {
      var c = Math.sqrt(Math.max(1, A * A - (yb - r) * (yb - r)));
      var large = yb < r ? 1 : 0;
      [shape.wheels[1], shape.wheels[0]].forEach(function (xw) {
        body += 'L' + f(xw + c) + ' ' + Yb + 'A' + A + ' ' + A + ' 0 ' + large + ' 0 ' + f(xw - c) + ' ' + Yb;
      });
    }
    body += 'Z';
    if (shape.win) {
      var w = shape.win;
      body += 'M' + f(w[0][0]) + ' ' + f(GROUND - w[0][1]) + spline(w, true) + 'Z';
    }
    var tires = '', rims = '', hubs = '';
    shape.wheels.forEach(function (xw) {
      var cy = GROUND - r;
      tires += circle(xw, cy, r) + circle(xw, cy, Math.round(r * 0.62));
      rims += circle(xw, cy, Math.round(r * 0.62));
      hubs += circle(xw, cy, Math.round(r * (shape.aero ? 0.46 : 0.2)));
    });
    var extra = '';
    (shape.extra || []).forEach(function (poly) {
      extra += 'M' + poly.map(function (p) { return f(p[0]) + ' ' + f(GROUND - p[1]); }).join('L') + 'Z';
    });
    var maxY = 0;
    top.forEach(function (p) { if (p[1] > maxY) maxY = p[1]; });
    (shape.extra || []).forEach(function (poly) { poly.forEach(function (p) { if (p[1] > maxY) maxY = p[1]; }); });
    return { body: body, tires: tires, rims: rims, hubs: hubs, extra: extra, top: GROUND - maxY - 8, height: maxY + 12 };
  }

  var cache = {};
  function svg(car, cls) {
    var b = cache[car.id] || (cache[car.id] = build(car.shape));
    return '<svg class="' + (cls || 'car-art') + '" viewBox="-4 ' + f(b.top) + ' 1008 ' + f(b.height) + '" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">' +
      '<path class="s-rim" d="' + b.rims + '"/>' +
      '<path class="s-body" fill-rule="evenodd" d="' + b.body + '"/>' +
      (b.extra ? '<path class="s-body" d="' + b.extra + '"/>' : '') +
      '<path class="s-tire" fill-rule="evenodd" d="' + b.tires + '"/>' +
      '<path class="s-hub" d="' + b.hubs + '"/></svg>';
  }

  window.ELECTRICSOUND_CARS = CARS;
  window.ElectricSoundArt = { svg: svg };
})();
