/*
 * ElectricSound app: car picker, gauge, GPS speed tracking, test drive and the
 * virtual gearbox that turns speed into revs for the synthesizer.
 */
(function () {
  'use strict';

  var CARS = window.ELECTRICSOUND_CARS, Art = window.ElectricSoundArt;
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var now = function () { return performance.now() / 1000; };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('electricsound.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('electricsound.' + k, v); } catch (e) { /* private mode */ } }
  };

  var imperial = /-(US|GB|LR|MM)$/i.test(navigator.language || '');
  var state = {
    car: CARS.filter(function (c) { return c.id === store.get('car', 'gt3'); })[0] || CARS[0],
    units: store.get('units', imperial ? 'mph' : 'kmh'),
    volume: clamp(parseInt(store.get('volume', '80'), 10) || 0, 0, 100),
    mode: store.get('mode', 'gps') === 'test' ? 'test' : 'gps',
    running: false, startT: 0,
    v: 0, acc: 0, thrIn: 0, brake: 0,
    gasHeld: false, brakeHeld: false, revHeld: false,
    gear: 0, shiftT: 0, shiftDir: 0, lastShift: 0, neutral: false, freeRpm: 0,
    rpm: 0, thrOut: 0, cutT: 0, limT: 0, limiting: false, label: '–', wobble: 0
  };

  // ------------------------------------------------------------------ audio
  var audio = { ctx: null, node: null, dsp: null, analyser: null, kind: '', ready: null, post: function () {} };

  function initAudio() {
    if (audio.ready) return audio.ready;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject(new Error('This browser has no Web Audio support.'));
    var ctx = audio.ctx = new AC({ latencyHint: 'interactive' });
    var out = ctx.createGain();
    audio.analyser = ctx.createAnalyser();
    audio.analyser.fftSize = 2048;
    out.connect(audio.analyser);
    out.connect(ctx.destination);

    function fallback() {
      var dsp = audio.dsp = new window.ElectricSoundDSP(ctx.sampleRate);
      var node = ctx.createScriptProcessor(1024, 0, 2);
      node.onaudioprocess = function (e) {
        var ob = e.outputBuffer;
        dsp.render(ob.getChannelData(0), ob.getChannelData(1), ob.length);
      };
      node.connect(out);
      audio.node = node; audio.kind = 'script';
      audio.post = function (m) { dsp.message(m); };
    }

    if (ctx.audioWorklet && window.AudioWorkletNode) {
      audio.ready = ctx.audioWorklet.addModule('js/engine-dsp.js').then(function () {
        var node = new AudioWorkletNode(ctx, 'electricsound-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        node.connect(out);
        audio.node = node; audio.kind = 'worklet';
        audio.post = function (m) { node.port.postMessage(m); };
      }).catch(fallback);
    } else {
      fallback();
      audio.ready = Promise.resolve();
    }
    return audio.ready;
  }

  // ------------------------------------------------------------------ GPS
  // A two-state (speed, acceleration) Kalman filter fed by GPS fixes. It reads
  // the receiver's own Doppler speed when the browser reports it and falls back
  // to distance between fixes when it does not.
  var gps = {
    watchId: null, v: 0, a: 0, p00: 25, p01: 0, p11: 4,
    lastFixT: 0, fixes: 0, prev: null, accuracy: null, source: '', error: '',
    zeroStreak: 0, useDerived: false, trail: [],

    start: function () {
      this.stop();
      this.v = 0; this.a = 0; this.p00 = 25; this.p01 = 0; this.p11 = 4;
      this.lastFixT = 0; this.fixes = 0; this.prev = null; this.accuracy = null; this.source = '';
      this.error = ''; this.zeroStreak = 0; this.useDerived = false; this.trail = [];
      if (!('geolocation' in navigator)) { this.error = 'unsupported'; return; }
      if (window.isSecureContext === false) { this.error = 'insecure'; return; }
      var self = this;
      this.watchId = navigator.geolocation.watchPosition(
        function (pos) { self.onFix(pos); },
        function (err) { self.error = err.code === 1 ? 'denied' : (self.fixes ? '' : 'unavailable'); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
    },
    stop: function () {
      if (this.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    },

    onFix: function (pos) {
      var c = pos.coords, t = now();
      this.error = '';
      this.accuracy = c.accuracy;

      // speed from distance between this fix and the last one
      var derived = null, sigmaD = 3, stepX, stepY;
      if (this.prev) {
        var dtp = (pos.timestamp - this.prev.ts) / 1000;
        if (dtp > 0.2 && dtp < 6) {
          var d = haversine(this.prev.lat, this.prev.lon, c.latitude, c.longitude);
          var worst = Math.max(c.accuracy || 10, this.prev.acc || 10);
          // A parked receiver jitters in random directions; a moving car keeps going one way.
          // So also look at the net distance covered over the last few fixes.
          var old = this.trail.length ? this.trail[0] : this.prev;
          var net = haversine(old.lat, old.lon, c.latitude, c.longitude);
          var rad = Math.PI / 180;
          stepY = (c.latitude - this.prev.lat) * 111320;
          stepX = (c.longitude - this.prev.lon) * 111320 * Math.cos(c.latitude * rad);
          var cos = this.prev.sx === undefined ? 0 :
            (stepX * this.prev.sx + stepY * this.prev.sy) / (Math.sqrt(stepX * stepX + stepY * stepY) * Math.sqrt(this.prev.sx * this.prev.sx + this.prev.sy * this.prev.sy) + 1e-6);
          var parked = (d < 0.6 * worst && net < 0.5 * worst) || (d / dtp < 4 && cos < 0.3);
          derived = parked ? 0 : d / dtp;
          sigmaD = clamp(0.35 * worst / dtp, 0.6, 6);
        }
      }
      if (this.prev) { this.trail.push(this.prev); if (this.trail.length > 3) this.trail.shift(); }
      this.prev = { lat: c.latitude, lon: c.longitude, ts: pos.timestamp, acc: c.accuracy, sx: stepX, sy: stepY };

      var doppler = (typeof c.speed === 'number' && isFinite(c.speed) && c.speed >= 0) ? c.speed : null;
      // some browsers report a constant zero instead of null: trust distance if they disagree
      if (doppler === 0 && derived !== null && derived > 3) this.zeroStreak++; else if (doppler) this.zeroStreak = 0;
      if (this.zeroStreak >= 3) this.useDerived = true;

      var z, r;
      if (doppler !== null && !this.useDerived) {
        z = doppler; var s = 0.3 + (c.accuracy || 5) / 40; r = s * s; this.source = 'doppler';
      } else if (derived !== null && (c.accuracy || 0) <= 100) {
        z = derived; r = sigmaD * sigmaD; this.source = 'position';
      } else {
        if (derived === null && doppler === null) this.fixes++;
        return;
      }
      if (z < 0.35) z = 0;

      if (!this.fixes || !this.lastFixT || t - this.lastFixT > 8) {
        this.v = z; this.a = 0; this.p00 = r; this.p01 = 0; this.p11 = 4;
      } else {
        var dt = clamp(t - this.lastFixT, 0.05, 5);
        // predict
        this.v += this.a * dt;
        var q = 6, dt2 = dt * dt;
        var p00 = this.p00 + dt * (2 * this.p01 + dt * this.p11) + q * dt2 * dt / 3;
        var p01 = this.p01 + dt * this.p11 + q * dt2 / 2;
        var p11 = this.p11 + q * dt;
        // update
        var sInv = 1 / (p00 + r), k0 = p00 * sInv, k1 = p01 * sInv, y = z - this.v;
        this.v += k0 * y; this.a += k1 * y;
        this.p00 = (1 - k0) * p00; this.p01 = (1 - k0) * p01; this.p11 = p11 - k1 * p01;
        if (z === 0) { this.a *= 0.4; if (this.v < 0.4) this.v = 0; }
        this.v = Math.max(0, this.v);
        this.a = clamp(this.a, -12, 12);
      }
      this.lastFixT = t;
      this.fixes++;
    },

    // best estimate right now, predicted forward from the last fix
    estimate: function (t) {
      if (!this.lastFixT) return { v: 0, a: 0, age: Infinity };
      var age = t - this.lastFixT;
      var lead = Math.min(age, 0.8);
      var a = age > 2.5 ? 0 : this.a;
      return { v: Math.max(0, this.v + a * lead), a: a, age: age };
    }
  };

  function haversine(la1, lo1, la2, lo2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLa = (la2 - la1) * rad, dLo = (lo2 - lo1) * rad;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ------------------------------------------------------------------ drivetrain
  function resetDrive() {
    state.gear = 0; state.shiftT = 0; state.shiftDir = 0; state.lastShift = 0;
    state.neutral = false; state.freeRpm = 0; state.cutT = 0; state.limT = 0; state.limiting = false;
  }

  function shift(dir, t) {
    var d = state.car.drive;
    state.gear += dir; state.shiftDir = dir; state.shiftT = d.shift; state.lastShift = t;
    if (dir > 0 && state.thrIn > 0.55 && (d.box === 'dct' || d.box === 'single' || d.box === 'seamless')) {
      audio.post({ pop: (d.box === 'single' ? 0.9 : 0.45) * state.thrIn });
    }
  }

  function stepTestPhysics(dt) {
    var d = state.car.drive, isEV = d.box === 'ev', v = state.v;
    state.thrIn = clamp(state.thrIn + clamp((state.gasHeld ? 1 : 0) - state.thrIn, -dt / 0.08, dt / 0.14), 0, 1);
    state.brake = clamp(state.brake + clamp((state.brakeHeld ? 1 : 0) - state.brake, -dt / 0.08, dt / 0.1), 0, 1);
    var pw = d.pw * 0.85;
    var vTop = d.gears[d.gears.length - 1] * 0.97 / 3.6;
    var drive = state.thrIn * Math.min(d.acc, pw / Math.max(v, 1));
    if (state.neutral || state.limiting) drive = 0;
    if (state.shiftT > 0 && state.shiftDir > 0 && (d.box === 'manual' || d.box === 'auto' || d.box === 'single')) drive = 0;
    var a = drive - (pw / (vTop * vTop * vTop)) * v * v;
    if (v > 0.05) {
      a -= 0.12;
      if (state.thrIn < 0.05) a -= isEV ? 1.6 : 0.4 + 0.9 * (state.rpm / d.redline);
    }
    a -= state.brake * 10.5;
    v += a * dt;
    if (v < 0) { v = 0; a = 0; }
    state.v = v; state.acc = a;
  }

  function stepGps(dt, t) {
    var est = gps.estimate(t);
    state.v += (est.v - state.v) * (1 - Math.exp(-dt / 0.12));
    if (est.v === 0 && state.v < 0.15) state.v = 0;
    state.acc = est.a;
    var load = est.a / 2.8 + 0.08 + 0.3 * Math.pow(state.v / 40, 2);
    var target = state.v < 0.4 || est.a < -0.35 ? 0 : clamp(load, 0, 1);
    state.thrIn += (target - state.thrIn) * (1 - Math.exp(-dt / 0.15));
    state.brake = 0;
  }

  function stepDrive(dt, t) {
    var d = state.car.drive, red = d.redline, idle = d.idle, isEV = d.box === 'ev';
    var kmh = state.v * 3.6, thr = state.thrIn;
    var rpmT, thrOut, tau = 0.06;
    state.limiting = false;
    if (state.cutT > 0) state.cutT -= dt;

    var wantRev = state.revHeld && state.v < 2.5;
    if (wantRev && !state.neutral) { state.neutral = true; state.freeRpm = Math.max(state.rpm, idle); }

    if (state.neutral) {
      var cap = isEV ? red * 0.3 : red;
      if (wantRev) state.freeRpm += d.revUp * dt * (1 - 0.45 * state.freeRpm / red);
      else state.freeRpm -= d.revDown * dt * (0.4 + state.freeRpm / red);
      if (state.freeRpm >= cap) {
        state.freeRpm = cap;
        if (!isEV) { state.cutT = 0.075; state.freeRpm -= red * 0.04; audio.post({ pop: 0.35 }); }
      }
      if (state.freeRpm < idle) state.freeRpm = idle;
      if (state.v >= 2.5 || (!wantRev && state.freeRpm <= idle + 40)) state.neutral = false;
      rpmT = state.freeRpm; thrOut = wantRev ? 1 : 0; tau = 0.03;
      state.label = isEV ? 'P' : 'N';
    } else if (isEV) {
      rpmT = red * kmh / d.gears[0];
      thrOut = thr; tau = 0.05;
      state.label = state.v < 0.3 ? 'P' : 'D';
    } else {
      var gears = d.gears, n = gears.length;
      var wheel = function (g) { return red * kmh / gears[g]; };
      if (state.v < 0.5 && thr < 0.05) state.gear = 0;
      if (state.gear >= n) state.gear = n - 1;
      if (state.shiftT > 0) {
        state.shiftT -= dt;
      } else if (t - state.lastShift > 0.25) {
        var r = wheel(state.gear);
        // hold the gear on a closed throttle so lift-off gives engine braking, not a string of upshifts
        var up = thr < 0.03 ? red * 0.82 : red * (0.36 + 0.615 * Math.pow(thr, 1.3));
        var down = Math.max(idle * 1.3, red * (0.16 + 0.36 * thr * thr));
        if (r > up && state.gear < n - 1 && wheel(state.gear + 1) > Math.max(idle * 1.15, down * 1.05)) shift(1, t);
        else if (r < down && state.gear > 0 && wheel(state.gear - 1) < Math.min(red * 0.9, up * 0.95)) shift(-1, t);
      }
      rpmT = wheel(state.gear);
      if (state.gear === 0) rpmT = Math.max(rpmT, idle + (red * 0.4 - idle) * thr); // clutch slip off the line
      if (rpmT < idle) rpmT = idle;
      thrOut = thr;
      if (rpmT >= red) {
        rpmT = red; state.limiting = true;
        state.limT += dt;
        if (state.limT > 0.13) { state.limT = 0; state.cutT = 0.065; }
      }
      if (state.shiftT > 0) {
        tau = Math.max(0.02, d.shift * 0.45);
        if (state.shiftDir > 0) { if (d.box !== 'seamless') thrOut = thr * 0.05; }
        else thrOut = Math.max(thr, 0.5); // rev-match blip
      }
      state.label = String(state.gear + 1);
    }

    state.rpm += (rpmT - state.rpm) * (1 - Math.exp(-dt / tau));
    state.thrOut = thrOut;

    // starter crank, then a flare up to idle
    var since = t - state.startT, rpmOut = state.rpm, cut = state.cutT > 0;
    if (!isEV) {
      if (since < 0.42) { rpmOut = 230 + 80 * Math.sin(since * 40); thrOut = 0.4; state.rpm = rpmOut; }
      else if (since < 1.1) { var k = 1 - (since - 0.42) / 0.68; thrOut = Math.max(thrOut, 0.5 * k); rpmOut = Math.max(rpmOut, idle * (1 + 0.7 * Math.sin(Math.PI * Math.min(1, (since - 0.42) / 0.5)) * k)); state.rpm = rpmOut; }
      // a little hunting at idle keeps it alive
      state.wobble += (Math.random() - 0.5) * dt * 6 - state.wobble * dt * 3;
      if (rpmOut < idle * 1.4) rpmOut *= 1 + clamp(state.wobble, -1, 1) * 0.02;
    }
    audio.post({ rpm: rpmOut, thr: thrOut, cut: cut });
  }

  // ------------------------------------------------------------------ main loop
  var lastStep = 0;
  function step() {
    var t = now(), dt = clamp(t - lastStep, 0.001, 0.1);
    lastStep = t;
    if (!state.running) {
      state.rpm += (0 - state.rpm) * (1 - Math.exp(-dt / 0.25));
      state.thrIn = 0; state.thrOut = 0;
      if (state.mode === 'test') { state.v = Math.max(0, state.v - 6 * dt); }
      return;
    }
    if (state.mode === 'test') stepTestPhysics(dt); else stepGps(dt, t);
    stepDrive(dt, t);
  }

  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
      else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { /* not supported */ }
  }

  function startEngine() {
    var p;
    try { p = initAudio(); } catch (e) { p = Promise.reject(e); }
    if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume();
    p.then(function () {
      if (audio.ctx.state !== 'running') audio.ctx.resume();
      resetDrive();
      state.running = true; state.startT = now(); lastStep = now();
      if (state.mode === 'test') state.v = 0;
      audio.post({ car: state.car.sound, volume: state.volume / 100, on: true, rpm: state.car.drive.box === 'ev' ? 0 : 230, thr: 0.3, cut: false, snap: true });
      if (state.mode === 'gps') gps.start();
      keepAwake(true);
      syncUI();
    }).catch(function (e) {
      setStatus('Could not start audio: ' + (e && e.message ? e.message : e), true);
    });
  }

  function stopEngine() {
    state.running = false;
    state.gasHeld = state.brakeHeld = state.revHeld = false;
    audio.post({ on: false, thr: 0 });
    gps.stop();
    keepAwake(false);
    state.label = '–';
    syncUI();
  }

  // ------------------------------------------------------------------ UI
  var el = {
    name: $('carName'), tag: $('carTag'), specs: $('carSpecs'), grid: $('carGrid'), count: $('carCount'),
    speed: $('speed'), unit: $('unit'), gear: $('gear'), rpm: $('rpm'), thr: $('thrBar'),
    start: $('startBtn'), startLabel: $('startLabel'), rev: $('revBtn'), pedals: $('pedals'),
    gas: $('gasPedal'), brake: $('brakePedal'), status: $('status'), volume: $('volume'), volumeOut: $('volumeOut'),
    canvas: $('gaugeCanvas'), bd: [$('bdA'), $('bdB')]
  };
  var bdIndex = 0;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- car photos: drop img/cars/<car id>.jpg|jpeg|png|webp in and it replaces the drawing.
  // A PNG/WebP with a transparent background is used like the silhouette; an ordinary
  // photo becomes a dimmed full-page background. No file means the drawing stays.
  var PHOTO_TYPES = ['jpg', 'jpeg', 'png', 'webp'], photoInfo = {}, photoWait = {};
  function isCutout(img) {
    try {
      var n = 24, c = document.createElement('canvas'); c.width = c.height = n;
      var g = c.getContext('2d'); g.drawImage(img, 0, 0, n, n);
      var d = g.getImageData(0, 0, n, n).data, clear = 0, h = n >> 1;
      [[0, 0], [n - 1, 0], [h, 0], [0, h], [n - 1, h], [0, n - 1], [n - 1, n - 1]].forEach(function (q) {
        if (d[(q[1] * n + q[0]) * 4 + 3] < 24) clear++;
      });
      return clear >= 5;
    } catch (e) { return false; } // opened as a file: canvas is locked, treat as a normal photo
  }
  function findPhoto(car) {
    if (!photoWait[car.id]) photoWait[car.id] = new Promise(function (resolve) {
      var i = 0;
      (function next() {
        if (i >= PHOTO_TYPES.length) return resolve(photoInfo[car.id] = null);
        var src = 'img/cars/' + car.id + '.' + PHOTO_TYPES[i++], img = new Image();
        img.onload = function () { resolve(photoInfo[car.id] = { src: src, cutout: isCutout(img) }); };
        img.onerror = next;
        img.src = src;
      })();
    });
    return photoWait[car.id];
  }
  function photoTag(q) { return '<img src="' + esc(q.src) + '" alt="" decoding="async" draggable="false">'; }

  // cross-fade the page-wide picture: the photo if there is one, otherwise the silhouette
  function showBackdrop(car) {
    var q = photoInfo[car.id], next = el.bd[bdIndex ^ 1], cur = el.bd[bdIndex];
    next.className = 'bd-layer' + (q ? ' photo ' + (q.cutout ? 'cutout' : 'full') : '');
    next.innerHTML = q ? photoTag(q) : Art.svg(car, 'bd-art');
    next.style.setProperty('--layer-accent', car.color);
    void next.offsetWidth;
    next.classList.add('show'); cur.classList.remove('show');
    bdIndex ^= 1;
    if (q === undefined) findPhoto(car).then(function (r) { if (r && state.car === car) showBackdrop(car); });
  }

  function buildGarage() {
    el.count.textContent = CARS.length;
    el.grid.innerHTML = CARS.map(function (c, i) {
      return '<button type="button" class="card" data-i="' + i + '" style="--car:' + c.color + '" aria-pressed="false">' +
        '<span class="art">' + Art.svg(c) + '</span>' +
        '<span class="card-name">' + esc(c.name) + '</span>' +
        '<span class="card-line">' + esc(c.line) + '</span>' +
        '<span class="card-tag">' + esc(c.tag.split(' · ')[0]) + '</span></button>';
    }).join('');
    CARS.forEach(function (c, i) {
      findPhoto(c).then(function (q) {
        if (!q) return;
        var art = el.grid.children[i].querySelector('.art');
        art.className = 'art photo ' + (q.cutout ? 'cutout' : 'full');
        art.innerHTML = photoTag(q);
      });
    });
    el.grid.addEventListener('click', function (e) {
      var b = e.target.closest('.card');
      if (!b) return;
      selectCar(CARS[+b.getAttribute('data-i')], true);
    });
  }

  function selectCar(car, fromGarage) {
    state.car = car;
    store.set('car', car.id);
    document.documentElement.style.setProperty('--accent', car.color);
    el.name.textContent = car.name;
    el.tag.textContent = car.tag;
    el.specs.innerHTML = Object.keys(car.specs).map(function (k) {
      return '<div><dt>' + esc(k) + '</dt><dd>' + esc(car.specs[k]) + '</dd></div>';
    }).join('');
    [].forEach.call(el.grid.children, function (b, i) { b.setAttribute('aria-pressed', CARS[i] === car ? 'true' : 'false'); });

    showBackdrop(car);

    gaugeScale = null;
    if (state.running) {
      resetDrive();
      state.startT = now() - 2; // no starter crank on a hot swap
      audio.post({ car: car.sound });
    }
    if (fromGarage) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setStatus(html, warn) {
    if (el.status._html === html) return;
    el.status._html = html;
    el.status.innerHTML = html;
    el.status.classList.toggle('warn', !!warn);
  }

  function updateStatus() {
    if (state.mode === 'test') {
      setStatus(state.running ? 'Hold <b>Gas</b> and <b>Brake</b>. On a keyboard use the up and down arrows, and R to rev.' : 'Test drive needs no GPS. Start the engine, then use the pedals.');
      return;
    }
    if (!state.running) { setStatus('The engine follows your real GPS speed. The browser asks for location when you start.'); return; }
    if (gps.error === 'denied') { setStatus('Location is blocked for this page. Allow it in the browser settings and start again, or use Test drive.', true); return; }
    if (gps.error === 'insecure') { setStatus('Location only works on a secure https address. Test drive still works here.', true); return; }
    if (gps.error === 'unsupported') { setStatus('This browser has no location support. Test drive still works.', true); return; }
    if (!gps.lastFixT) { setStatus(gps.error === 'unavailable' ? 'No GPS signal yet. Still trying…' : 'Waiting for a GPS fix…', gps.error === 'unavailable'); return; }
    var age = now() - gps.lastFixT;
    if (age > 5) { setStatus('GPS signal lost. Holding the last speed.', true); return; }
    var acc = gps.accuracy ? ' · ±' + Math.round(gps.accuracy) + ' m' : '';
    setStatus('<b>GPS locked</b>' + acc + ' · ' + (gps.source === 'doppler' ? 'satellite Doppler speed' : 'speed from position fixes'));
  }

  function syncUI() {
    [].forEach.call(document.querySelectorAll('[data-unit]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-unit') === state.units ? 'true' : 'false'); });
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode') === state.mode ? 'true' : 'false'); });
    el.unit.textContent = state.units === 'mph' ? 'mph' : 'km/h';
    el.start.classList.toggle('running', state.running);
    el.startLabel.textContent = state.running ? 'Stop engine' : 'Start engine';
    el.rev.disabled = !state.running;
    el.pedals.hidden = state.mode !== 'test';
    el.volume.value = state.volume;
    el.volumeOut.textContent = state.volume + '%';
    updateStatus();
  }

  function hold(button, key) {
    var set = function (on) {
      return function (e) {
        if (on && button.disabled) return;
        if (e.cancelable) e.preventDefault();
        if (on && e.pointerId !== undefined && button.setPointerCapture) { try { button.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
        state[key] = on && state.running;
        button.classList.toggle('down', state[key]);
      };
    };
    button.addEventListener('pointerdown', set(true));
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { button.addEventListener(n, set(false)); });
    button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function bind() {
    document.querySelectorAll('[data-unit]').forEach(function (b) {
      b.addEventListener('click', function () { state.units = b.getAttribute('data-unit'); store.set('units', state.units); gaugeScale = null; syncUI(); });
    });
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode');
        if (m === state.mode) return;
        state.mode = m; store.set('mode', m);
        state.gasHeld = state.brakeHeld = false;
        if (state.running) {
          resetDrive(); state.v = 0; state.thrIn = 0;
          if (m === 'gps') gps.start(); else gps.stop();
        }
        syncUI();
      });
    });
    el.start.addEventListener('click', function () { if (state.running) stopEngine(); else startEngine(); });
    hold(el.rev, 'revHeld'); hold(el.gas, 'gasHeld'); hold(el.brake, 'brakeHeld');
    el.volume.addEventListener('input', function () {
      state.volume = +el.volume.value; store.set('volume', state.volume);
      el.volumeOut.textContent = state.volume + '%';
      audio.post({ volume: state.volume / 100 });
    });
    $('changeCar').addEventListener('click', function () { $('garage').scrollIntoView({ behavior: 'smooth' }); });

    var fs = $('fsBtn'), root = document.documentElement;
    var reqFs = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!reqFs) fs.hidden = true;
    fs.addEventListener('click', function () {
      var cur = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (cur) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else { var p = reqFs.call(root); if (p && p.catch) p.catch(function () {}); }
      } catch (e) { /* ignore */ }
    });

    var keys = { ArrowUp: 'gasHeld', w: 'gasHeld', W: 'gasHeld', ArrowDown: 'brakeHeld', s: 'brakeHeld', S: 'brakeHeld', r: 'revHeld', R: 'revHeld' };
    window.addEventListener('keydown', function (e) {
      var k = keys[e.key];
      if (!k || !state.running || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (k !== 'revHeld' && state.mode !== 'test') return;
      e.preventDefault();
      state[k] = true;
    });
    window.addEventListener('keyup', function (e) { var k = keys[e.key]; if (k) state[k] = false; });
    window.addEventListener('blur', function () { state.gasHeld = state.brakeHeld = state.revHeld = false; });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && state.running) keepAwake(true); });
    window.addEventListener('resize', function () { gaugeSize = null; });
  }

  // ------------------------------------------------------------------ gauge
  var gctx = el.canvas.getContext('2d');
  var gaugeSize = null, gaugeScale = null;
  var A0 = 140 * Math.PI / 180, SWEEP = 260 * Math.PI / 180;

  function scaleFor(car) {
    var red = car.drive.redline;
    var max = Math.ceil((red + 200) / 1000);
    var labelStep = max > 12 ? 2 : 1;
    if (max % labelStep) max++;
    var per = max > 12 ? 3 : 6;
    return { max: max * 1000, n: max * per, labelStep: labelStep, redFrom: (red * 0.9) / (max * 1000) };
  }

  function drawGauge() {
    var c = el.canvas;
    if (!gaugeSize) {
      var rect = c.getBoundingClientRect();
      if (!rect.width) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
      gaugeSize = { w: rect.width, h: rect.height, dpr: dpr };
    }
    if (!gaugeScale) gaugeScale = scaleFor(state.car);
    var g = gctx, w = gaugeSize.w, h = gaugeSize.h, sc = gaugeScale;
    g.setTransform(gaugeSize.dpr, 0, 0, gaugeSize.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var pad = 8;
    var R = Math.min(w / 2 - pad, (h - pad * 2) / (1 + Math.sin(A0)));
    var cx = w / 2, cy = pad + R;
    var accent = state.car.color;
    var frac = clamp(state.rpm / sc.max, 0, 1);
    var lit = frac * sc.n;
    var rOut = R, rIn = R - Math.max(14, R * 0.105);
    g.lineCap = 'butt';
    g.lineWidth = Math.max(2, (SWEEP * R / sc.n) * 0.56);
    for (var i = 0; i < sc.n; i++) {
      var f = (i + 0.5) / sc.n, a = A0 + f * SWEEP;
      var red = f >= sc.redFrom;
      var on = i + 0.5 < lit;
      g.strokeStyle = on ? (red ? '#ff3b3b' : accent) : (red ? '#4d1c20' : '#252930');
      var ca = Math.cos(a), sa = Math.sin(a);
      g.beginPath();
      g.moveTo(cx + ca * rIn, cy + sa * rIn);
      g.lineTo(cx + ca * rOut, cy + sa * rOut);
      g.stroke();
    }
    // numerals
    g.fillStyle = '#8b93a0';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 ' + Math.round(Math.max(12, R * 0.075)) + 'px Saira, sans-serif';
    var rl = rIn - Math.max(13, R * 0.085);
    for (var k = 0; k <= sc.max / 1000; k += sc.labelStep) {
      var al = A0 + (k * 1000 / sc.max) * SWEEP;
      g.fillStyle = k * 1000 / sc.max >= sc.redFrom ? '#ff6b6b' : '#8b93a0';
      g.fillText(String(k), cx + Math.cos(al) * rl, cy + Math.sin(al) * rl);
    }
  }

  var lastText = {};
  function setText(node, key, v) { if (lastText[key] !== v) { lastText[key] = v; node.textContent = v; } }

  var statusT = 0;
  function frame() {
    drawGauge();
    var sp = state.v * (state.units === 'mph' ? 2.23694 : 3.6);
    setText(el.speed, 'speed', String(Math.round(sp)));
    setText(el.gear, 'gear', state.running ? state.label : '–');
    setText(el.rpm, 'rpm', String(Math.round(state.rpm / 10) * 10));
    el.thr.style.transform = 'scaleX(' + state.thrOut.toFixed(3) + ')';
    if (state.mode === 'test') {
      el.gas.lastElementChild.style.transform = 'scaleY(' + state.thrIn.toFixed(3) + ')';
      el.brake.lastElementChild.style.transform = 'scaleY(' + state.brake.toFixed(3) + ')';
    }
    var t = now();
    if (t - statusT > 0.3) { statusT = t; updateStatus(); }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ boot
  buildGarage();
  bind();
  selectCar(state.car, false);
  syncUI();
  lastStep = now();
  setInterval(step, 1000 / 60);
  requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { gaugeSize = null; });

  window.__electricsound = { state: state, audio: audio, gps: gps, step: step };
})();
