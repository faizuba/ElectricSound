/*
 * ElectricSound engine synthesis.
 *
 * Nothing here is a recording. Each cylinder fires an exhaust pulse at its real
 * position in the 720-degree cycle, the pulses of each cylinder bank run through
 * a pair of pipe resonators, then a muffler, body resonances and saturation.
 * Intake roar, turbo and supercharger whine, blow-off and overrun crackle are
 * layered on top. Electric profiles use a separate motor-whine voice.
 *
 * The same file runs as an AudioWorklet module and, where worklets are not
 * available, as a plain script driving a ScriptProcessor.
 */
(function (root) {
  'use strict';

  var TWO_PI = Math.PI * 2;
  var SHAPE_N = 1024;
  var DELAY_N = 4096;
  var MAX_CYL = 16;

  // Exhaust pulse: quick rise, exponential tail, tapered to zero at the end.
  function buildShape() {
    var t = new Float32Array(SHAPE_N + 2);
    var rise = 0.085;
    for (var i = 0; i <= SHAPE_N; i++) {
      var u = i / SHAPE_N;
      var a = u < rise ? 0.5 - 0.5 * Math.cos(Math.PI * u / rise) : Math.exp(-(u - rise) * 5.2);
      var taper = u > 0.8 ? 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.8) / 0.2) : 1;
      t[i] = a * taper;
    }
    t[SHAPE_N + 1] = 0;
    return t;
  }

  function Biquad() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  Biquad.prototype.reset = function () { this.z1 = 0; this.z2 = 0; };
  Biquad.prototype.lowpass = function (f, q, sr) {
    var w = TWO_PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    var a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  };
  Biquad.prototype.bandpass = function (f, q, sr) {
    var w = TWO_PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    var a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  };
  Biquad.prototype.highpass = function (f, q, sr) {
    var w = TWO_PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    var a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  };
  // Transposed direct form II
  Biquad.prototype.run = function (x) {
    var y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  };

  function EngineDSP(sampleRate) {
    this.sr = sampleRate;
    this.shape = buildShape();
    this.cfg = null;
    this.on = false;
    this.level = 0;
    this.volume = 0.8;
    this.seed = 0x2545f491;

    this.tRpm = 0; this.rpm = 0;
    this.tThr = 0; this.thr = 0;
    this.cut = false;
    this.phase = 0;

    this.off = new Float32Array(MAX_CYL);
    this.bank = new Uint8Array(MAX_CYL);
    this.baseGain = new Float32Array(MAX_CYL);
    this.curGain = new Float32Array(MAX_CYL);
    this.prevX = new Float32Array(MAX_CYL);

    this.hd = [new Float32Array(DELAY_N), new Float32Array(DELAY_N)]; // header delay
    this.pd = [new Float32Array(DELAY_N), new Float32Array(DELAY_N)]; // pipe delay
    this.dw = 0;
    this.hLen = [48, 52]; this.pLen = [400, 430];
    this.hLp = [0, 0]; this.pLp = [0, 0];
    this.popE = [0, 0];

    this.dcX = [0, 0]; this.dcY = [0, 0];
    this.muff = [new Biquad(), new Biquad()];
    this.muff2 = [new Biquad(), new Biquad()];
    this.form = [];
    for (var k = 0; k < 3; k++) this.form.push([new Biquad(), new Biquad()]);
    this.formG = [0, 0, 0];
    this.intakeF = new Biquad();
    this.bovF = new Biquad();
    this.thrF = new Biquad();
    this.thrLp = 0;

    this.spool = 0; this.turboPh = 0; this.scPh = 0;
    this.bovE = 0; this.overrun = 0; this.thrPeak = 0; this.liftArmed = true;
    this.pendingPop = 0;
    this.idleComp = 1;

    this.evPh = [0, 0]; this.evLp = [0, 0]; this.thrustE = 0;

    this.norm = 1;
    this._cal = false; this._acc = 0; this._accN = 0;
  }

  EngineDSP.prototype.rand = function () {
    // xorshift32, returns -1..1
    var s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s;
    return (s >>> 0) / 2147483648 - 1;
  };

  EngineDSP.prototype.resetState = function () {
    var i;
    for (i = 0; i < 2; i++) {
      this.hd[i].fill(0); this.pd[i].fill(0);
      this.hLp[i] = 0; this.pLp[i] = 0; this.popE[i] = 0;
      this.dcX[i] = 0; this.dcY[i] = 0;
      this.muff[i].reset(); this.muff2[i].reset();
      for (var k = 0; k < 3; k++) this.form[k][i].reset();
      this.evLp[i] = 0;
    }
    this.intakeF.reset(); this.bovF.reset(); this.thrF.reset();
    this.thrLp = 0; this.spool = 0; this.bovE = 0; this.overrun = 0;
    this.thrPeak = 0; this.thrustE = 0; this.pendingPop = 0;
    for (i = 0; i < MAX_CYL; i++) { this.prevX[i] = 0; this.curGain[i] = 0; }
  };

  EngineDSP.prototype.setCar = function (cfg) {
    var sr = this.sr, i;
    this.cfg = cfg;
    this.resetState();
    if (cfg.type !== 'ev') {
      var n = cfg.offsets.length;
      this.nCyl = n;
      this.banks = 1;
      for (i = 0; i < n; i++) {
        this.off[i] = cfg.offsets[i];
        this.bank[i] = cfg.bank[i] ? 1 : 0;
        if (cfg.bank[i]) this.banks = 2;
        // Fixed per-cylinder imbalance (unequal runner lengths) adds half-order growl.
        this.baseGain[i] = 1 + (((i * 7919) % 13) / 13 - 0.5) * 0.16;
      }
      for (i = 0; i < 2; i++) {
        var skew = i ? 1.07 : 1;
        this.hLen[i] = Math.max(4, Math.min(DELAY_N - 2, Math.round(cfg.header[0] * 0.001 * sr * skew)));
        this.pLen[i] = Math.max(8, Math.min(DELAY_N - 2, Math.round(cfg.pipe[0] * 0.001 * sr * skew)));
      }
      for (var k = 0; k < 3; k++) {
        var f = cfg.formants[k];
        this.formG[k] = f ? f[2] : 0;
        if (f) { this.form[k][0].bandpass(f[0], f[1], sr); this.form[k][1].bandpass(f[0] * 1.03, f[1], sr); }
      }
      this.bovF.bandpass(3200, 0.9, sr);
      this.calibrate();
    } else {
      this.thrF.bandpass(1500, 0.5, sr);
      this.norm = 1;
    }
  };

  // Render a short burst at mid revs and full load to level every car the same.
  EngineDSP.prototype.calibrate = function () {
    var cfg = this.cfg, n = Math.round(this.sr * 0.35), bl = 128;
    var L = new Float32Array(bl), R = new Float32Array(bl);
    var keep = { on: this.on, level: this.level, tRpm: this.tRpm, rpm: this.rpm, tThr: this.tThr, thr: this.thr, cut: this.cut, seed: this.seed };
    this.norm = 1; this.on = true; this.level = 1; this.cut = false;
    this.tRpm = this.rpm = cfg.redline * 0.6; this.tThr = this.thr = 1;
    this._acc = 0; this._accN = 0;
    for (var done = 0; done < n; done += bl) {
      this._cal = done > n * 0.3;
      this.render(L, R, bl);
    }
    this._cal = false;
    var rms = Math.sqrt(this._acc / Math.max(1, this._accN));
    this.norm = rms > 1e-6 ? 0.2 / rms : 1;
    this.resetState();
    this.on = keep.on; this.level = keep.level; this.tRpm = keep.tRpm; this.rpm = keep.rpm;
    this.tThr = keep.tThr; this.thr = keep.thr; this.cut = keep.cut; this.seed = keep.seed;
    this.phase = 0;
  };

  EngineDSP.prototype.message = function (m) {
    if (m.car) this.setCar(m.car);
    if (m.rpm !== undefined) this.tRpm = m.rpm;
    if (m.thr !== undefined) this.tThr = m.thr;
    if (m.cut !== undefined) this.cut = !!m.cut;
    if (m.on !== undefined) this.on = !!m.on;
    if (m.volume !== undefined) this.volume = m.volume;
    if (m.pop) this.pendingPop = Math.max(this.pendingPop, m.pop);
    if (m.snap) { this.rpm = this.tRpm; this.thr = this.tThr; }
  };

  EngineDSP.prototype.render = function (L, R, n) {
    var cfg = this.cfg, i;
    if (!cfg || (!this.on && this.level < 1e-4)) {
      for (i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
      this.level = 0;
      return;
    }
    if (cfg.type === 'ev') this.renderEV(L, R, n); else this.renderICE(L, R, n);
  };

  EngineDSP.prototype.renderICE = function (L, R, n) {
    var cfg = this.cfg, sr = this.sr, shape = this.shape, i;
    var nCyl = this.nCyl, off = this.off, bank = this.bank, baseGain = this.baseGain, curGain = this.curGain, prevX = this.prevX;
    var red = cfg.redline;
    var rpmN = Math.min(1.1, Math.max(0, this.rpm / red));
    var thrB = this.thr;

    // ---- block-rate updates ----
    var dtB = n / sr;
    var load = Math.pow(thrB, 0.7);
    var fc = cfg.muffle[0] + (cfg.muffle[1] - cfg.muffle[0]) * Math.min(1, load * 0.72 + rpmN * 0.28);
    this.muff[0].lowpass(fc, 0.8, sr); this.muff[1].lowpass(fc, 0.8, sr);
    this.muff2[0].lowpass(fc * 1.9, 0.6, sr); this.muff2[1].lowpass(fc * 1.9, 0.6, sr);
    this.intakeF.bandpass(cfg.intakeHz * (0.65 + 0.75 * rpmN), 1.1, sr);

    // lift-off detection: overrun crackle + blow-off
    this.thrPeak = Math.max(this.tThr, this.thrPeak - dtB / 0.5);
    if (this.tThr > 0.2) this.liftArmed = true;
    if (this.liftArmed && this.tThr < 0.08 && this.thrPeak > 0.5) {
      this.liftArmed = false;
      if (rpmN > 0.38) this.overrun = 1;
      if (cfg.turbo > 0 && this.spool > 0.4) this.bovE = this.spool;
    }
    this.overrun *= Math.exp(-dtB / 0.9);
    this.bovE *= Math.exp(-dtB / 0.16);
    var spoolT = cfg.turbo > 0 ? Math.min(1, thrB * (0.25 + 1.1 * rpmN)) : 0;
    this.spool += (spoolT - this.spool) * (1 - Math.exp(-dtB / (spoolT > this.spool ? 0.45 : 0.2)));
    var spool = this.spool;

    var idleCompT = 1 / (0.22 + 0.78 * Math.sqrt(Math.min(1, rpmN + 0.02)));
    this.idleComp += (idleCompT - this.idleComp) * 0.1;

    var popProb = cfg.pops * this.overrun * 0.22;
    var idleness = Math.max(0, 1 - rpmN * 4);
    var jitter = cfg.jitter * (0.6 + 1.2 * idleness);
    var lope = cfg.lope * idleness;
    var popDecay = Math.exp(-1 / (sr * 0.011));
    var kR = 1 - Math.exp(-1 / (sr * 0.018));
    var kT = 1 - Math.exp(-1 / (sr * 0.012));
    var kH = 1 - Math.exp(-TWO_PI * cfg.loopHz * 1.6 / sr);
    var kP = 1 - Math.exp(-TWO_PI * cfg.loopHz / sr);
    var hFb = cfg.header[1], pFb = cfg.pipe[1], xmix = cfg.xmix;
    var noiseAmt = cfg.noise, offLoad = cfg.offLoad + 0.25 * idleness; // an idling engine is louder than one on overrun
    var twoBanks = this.banks === 2;
    var pan = twoBanks ? cfg.pan : 0;
    var gA = 0.5 + pan, gB = 0.5 - pan;
    var drive = cfg.drive, norm = this.norm, idleComp = this.idleComp;
    var intakeAmt = cfg.intake;
    var turboAmt = cfg.turbo * 0.05 * spool * spool;
    var turboInc = TWO_PI * (2600 + 7400 * spool) / sr;
    var scAmt = cfg.sc * 0.06 * (0.25 + 0.75 * thrB) * Math.min(1, rpmN * 1.2);
    var scInc = TWO_PI * (this.rpm / 60) * 13.5 / sr;
    var bovE = this.bovE * cfg.turbo;
    var vol = this.volume;
    var levelT = this.on ? 1 : 0;
    var kL = 1 - Math.exp(-1 / (sr * 0.05));
    var hd0 = this.hd[0], hd1 = this.hd[1], pd0 = this.pd[0], pd1 = this.pd[1];
    var hL0 = this.hLen[0], hL1 = this.hLen[1], pL0 = this.pLen[0], pL1 = this.pLen[1];
    var dw = this.dw, mask = DELAY_N - 1;
    var hLp0 = this.hLp[0], hLp1 = this.hLp[1], pLp0 = this.pLp[0], pLp1 = this.pLp[1];
    var popE0 = this.popE[0], popE1 = this.popE[1];
    var dcX0 = this.dcX[0], dcX1 = this.dcX[1], dcY0 = this.dcY[0], dcY1 = this.dcY[1];
    var m0 = this.muff[0], m1 = this.muff[1], n0 = this.muff2[0], n1 = this.muff2[1];
    var form = this.form, fG = this.formG;
    var rpm = this.rpm, thr = this.thr, phase = this.phase, level = this.level;
    var tRpm = this.tRpm, tThr = this.tThr, cut = this.cut;
    var cal = this._cal, acc = 0;

    if (this.pendingPop > 0) {
      popE0 += this.pendingPop; if (twoBanks) popE1 += this.pendingPop * 0.8;
      this.pendingPop = 0;
    }

    for (i = 0; i < n; i++) {
      rpm += (tRpm - rpm) * kR;
      thr += (tThr - thr) * kT;
      var cf = rpm / 120;
      phase += cf / sr;
      if (phase >= 1) phase -= 1;

      var w = cfg.pulseMs * 0.001 * (1.4 - 0.55 * thr) * cf;
      if (w > 0.48) w = 0.48;
      var invW = SHAPE_N / w;
      var b0 = 0, b1 = 0;

      for (var c = 0; c < nCyl; c++) {
        var x = phase - off[c];
        if (x < 0) x += 1;
        if (x < prevX[c]) {
          // this cylinder just fired: fix the strength of the whole pulse
          var g = baseGain[c] * (offLoad + (1 - offLoad) * thr) * (1 + jitter * this.rand());
          if (lope > 0) { var rr = this.rand(); if (rr > 0.35) g *= 1 - lope * rr; }
          if (cut) g *= 0.06;
          curGain[c] = g;
          if (popProb > 0 && this.rand() * 0.5 + 0.5 < popProb) {
            var pk = 0.5 + 0.5 * (this.rand() * 0.5 + 0.5);
            if (bank[c]) popE1 += pk; else popE0 += pk;
          }
        }
        prevX[c] = x;
        if (x < w) {
          var u = x * invW, ix = u | 0;
          var p = (shape[ix] + (shape[ix + 1] - shape[ix]) * (u - ix)) * curGain[c];
          if (bank[c]) b1 += p; else b0 += p;
        }
      }

      var wn = this.rand();
      var intakeMod = b0 + b1;
      // turbulent flow rides on each pulse; pops are raw bursts into the pipe
      b0 += b0 * wn * noiseAmt + wn * popE0 * 1.6;
      popE0 *= popDecay;

      // header + pipe resonators (quarter-wave: inverting feedback)
      var r = hd0[(dw - hL0) & mask]; hLp0 += (r - hLp0) * kH;
      var h0 = b0 - hFb * hLp0; hd0[dw] = h0;
      r = pd0[(dw - pL0) & mask]; pLp0 += (r - pLp0) * kP;
      var e0 = h0 - pFb * pLp0, e1 = 0;

      if (twoBanks) {
        var wn2 = this.rand();
        b1 += b1 * wn2 * noiseAmt + wn2 * popE1 * 1.6;
        popE1 *= popDecay;
        r = hd1[(dw - hL1) & mask]; hLp1 += (r - hLp1) * kH;
        var h1 = b1 - hFb * hLp1; hd1[dw] = h1;
        r = pd1[(dw - pL1) & mask]; pLp1 += (r - pLp1) * kP;
        e1 = h1 - pFb * pLp1;
        // crossover pipe bleeds each bank into the other
        pd0[dw] = e0 + xmix * (e1 - e0) * 0.5;
        pd1[dw] = e1 + xmix * (e0 - e1) * 0.5;
      } else {
        pd0[dw] = e0;
        e1 = e0;
      }
      dw = (dw + 1) & mask;

      var sl = e0 * gA + e1 * gB, sr2 = e1 * gA + e0 * gB;

      // DC block
      var y0 = sl - dcX0 + 0.996 * dcY0; dcX0 = sl; dcY0 = y0;
      var y1 = sr2 - dcX1 + 0.996 * dcY1; dcX1 = sr2; dcY1 = y1;

      if (cal) acc += y0 * y0 + y1 * y1;
      y0 *= norm; y1 *= norm;

      var bright = 0.3 + 0.7 * thr;
      var o0 = m0.run(y0), o1 = m1.run(y1);
      var pre0 = n0.run(y0) * bright, pre1 = n1.run(y1) * bright;
      o0 += fG[0] * form[0][0].run(pre0) + fG[1] * form[1][0].run(pre0) + fG[2] * form[2][0].run(pre0);
      o1 += fG[0] * form[0][1].run(pre1) + fG[1] * form[1][1].run(pre1) + fG[2] * form[2][1].run(pre1);

      var dg = drive * (0.55 + 0.75 * thr) * idleComp;
      o0 = Math.tanh(o0 * dg) * 0.62;
      o1 = Math.tanh(o1 * dg) * 0.62;

      // intake roar: noise gated by the same pulses
      var extra = this.intakeF.run(wn) * intakeAmt * thr * (0.3 + 0.7 * rpmN) * (0.5 + 0.35 * intakeMod);
      if (turboAmt > 0 || bovE > 0.001) {
        this.turboPh += turboInc; if (this.turboPh > TWO_PI) this.turboPh -= TWO_PI;
        extra += Math.sin(this.turboPh) * turboAmt + this.bovF.run(wn) * bovE * 0.5;
      }
      if (scAmt > 0) {
        this.scPh += scInc; if (this.scPh > TWO_PI) this.scPh -= TWO_PI;
        extra += (Math.sin(this.scPh) + 0.45 * Math.sin(this.scPh * 2 + 0.6)) * scAmt;
      }

      level += (levelT - level) * kL;
      var gOut = level * vol;
      o0 = (o0 + extra) * gOut; o1 = (o1 + extra) * gOut;
      L[i] = o0 > 1 ? 1 : o0 < -1 ? -1 : o0;
      R[i] = o1 > 1 ? 1 : o1 < -1 ? -1 : o1;
    }

    this.dw = dw; this.rpm = rpm; this.thr = thr; this.phase = phase; this.level = level;
    this.hLp[0] = hLp0; this.hLp[1] = hLp1; this.pLp[0] = pLp0; this.pLp[1] = pLp1;
    this.popE[0] = popE0; this.popE[1] = popE1;
    this.dcX[0] = dcX0; this.dcX[1] = dcX1; this.dcY[0] = dcY0; this.dcY[1] = dcY1;
    if (cal) { this._acc += acc; this._accN += n * 2; }
  };

  EngineDSP.prototype.renderEV = function (L, R, n) {
    var cfg = this.cfg, sr = this.sr, i;
    var rpmN = Math.min(1.05, Math.max(0, this.rpm / cfg.redline));
    var thrB = this.thr;
    var kR = 1 - Math.exp(-1 / (sr * 0.03));
    var kT = 1 - Math.exp(-1 / (sr * 0.03));
    var rpm = this.rpm, thr = this.thr, tRpm = this.tRpm, tThr = this.tThr;
    var p0 = this.evPh[0], p1 = this.evPh[1];
    var lp0 = this.evLp[0], lp1 = this.evLp[1];
    var level = this.level, levelT = this.on ? 1 : 0;
    var kL = 1 - Math.exp(-1 / (sr * 0.08));
    var vol = this.volume;
    var h = cfg.harm;
    var dtB = n / sr;
    var moving = rpmN > 0.004;
    // thrusters fire on a hard launch
    var thrustT = cfg.thrusters > 0 && thrB > 0.85 ? 1 : 0;
    this.thrustE += (thrustT - this.thrustE) * (1 - Math.exp(-dtB / (thrustT ? 0.03 : 0.3)));
    var thrustE = this.thrustE * cfg.thrusters;
    var kBuzz = 1 - Math.exp(-TWO_PI * (500 + 5200 * thrB * thrB + 2400 * rpmN) / sr);
    var regen = moving && thrB < 0.03 ? cfg.regen : 1;

    for (i = 0; i < n; i++) {
      rpm += (tRpm - rpm) * kR;
      thr += (tThr - thr) * kT;
      var rn = rpm / cfg.redline;
      var f = cfg.f0 + cfg.span * Math.pow(rn < 0 ? 0 : rn, cfg.curve);
      var inc = f / sr;
      p0 += inc; if (p0 >= 1) p0 -= 1;
      p1 += inc * 1.006; if (p1 >= 1) p1 -= 1;
      var a0 = p0 * TWO_PI, a1 = p1 * TWO_PI;
      var amp = (cfg.idleAmp + (1 - cfg.idleAmp) * Math.pow(thr, 0.8)) * (0.35 + 0.65 * Math.min(1, rn * 5 + (rn > 0.004 ? 0.2 : 0))) * regen;
      var s0 = Math.sin(a0) * h[0] + Math.sin(a0 * 2) * h[1] + Math.sin(a0 * 3) * h[2] + Math.sin(a0 * 6.02) * h[3] + Math.sin(a0 * 0.5) * cfg.sub;
      var s1 = Math.sin(a1) * h[0] + Math.sin(a1 * 2) * h[1] + Math.sin(a1 * 3) * h[2] + Math.sin(a1 * 6.02) * h[3] + Math.sin(a1 * 0.5) * cfg.sub;
      // saw buzz that opens up with the pedal
      lp0 += ((2 * p0 - 1) - lp0) * kBuzz;
      lp1 += ((2 * p1 - 1) - lp1) * kBuzz;
      s0 += lp0 * cfg.buzz * (0.25 + 0.75 * thr);
      s1 += lp1 * cfg.buzz * (0.25 + 0.75 * thr);
      var o0 = s0 * amp * 0.34, o1 = s1 * amp * 0.34;
      if (thrustE > 0.001) {
        var wn = this.rand();
        this.thrLp += (wn - this.thrLp) * 0.02;
        var t = (this.thrF.run(wn) * 0.9 + this.thrLp * 2.2) * thrustE;
        o0 += t; o1 += t;
      }
      level += (levelT - level) * kL;
      o0 = Math.tanh(o0 * 1.3) * level * vol;
      o1 = Math.tanh(o1 * 1.3) * level * vol;
      L[i] = o0; R[i] = o1;
    }
    this.rpm = rpm; this.thr = thr; this.evPh[0] = p0; this.evPh[1] = p1;
    this.evLp[0] = lp0; this.evLp[1] = lp1; this.level = level;
  };

  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor !== 'undefined') {
    // AudioWorklet global scope
    class ElectricSoundProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.dsp = new EngineDSP(sampleRate);
        this.port.onmessage = (e) => this.dsp.message(e.data);
      }
      process(inputs, outputs) {
        var out = outputs[0];
        var L = out[0], R = out[1] || out[0];
        this.dsp.render(L, R, L.length);
        return true;
      }
    }
    registerProcessor('electricsound-engine', ElectricSoundProcessor);
  } else {
    root.ElectricSoundDSP = EngineDSP;
    if (typeof module !== 'undefined' && module.exports) module.exports = EngineDSP;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
