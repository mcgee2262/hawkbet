/* Hallway Dash in real 3D (three.js). Only draws the world; app.js keeps the game rules, the HUD and the effects.
   World units: the runner stands at z = 0 and the hallway runs toward -z. One row = ROW units. */
(function () {
  const T = window.THREE; if (!T) return;
  const LANE = 2.6, ROW = 3.4, WALL = 4.9, CEIL = 4.7, AHEAD = 20, POOL = AHEAD + 6, VX = 200, LANEPX = 122;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const mats = {}, mat = (col, extra) => { const k = col + (extra ? JSON.stringify(extra) : ''); return mats[k] || (mats[k] = new T.MeshLambertMaterial({ color: col, ...extra })); };
  const geos = {}, G = (k, f) => geos[k] || (geos[k] = f());
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); return o; };
  const M = c => typeof c === 'object' ? c : mat(c);
  const box = (w, h, d, col, x, y, z) => mesh(G(`b${w},${h},${d}`, () => new T.BoxGeometry(w, h, d)), M(col), x, y, z);
  const cyl = (rt, rb, h, col, x, y, z, seg = 14) => mesh(G(`c${rt},${rb},${h},${seg}`, () => new T.CylinderGeometry(rt, rb, h, seg)), M(col), x, y, z);
  const sph = (r, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = mesh(G(`s${r}`, () => new T.SphereGeometry(r, 18, 14)), M(col), x, y, z); o.scale.set(sx, sy, sz); return o; };
  const cap = (r, len, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = mesh(G(`k${r},${len}`, () => new T.CapsuleGeometry(r, len, 6, 16)), M(col), x, y, z); o.scale.set(sx, sy, sz); return o; };
  const grp = (...kids) => { const g = new T.Group(); kids.forEach(k => k && g.add(k)); return g; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.anisotropy = 4; return t; };
  const rep = t => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };

  /* ---------- procedural textures: woven fabric, brushed metal, tiles, feathers ---------- */
  const weave = rep(tex(64, 64, (g, w, h) => { g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { g.fillStyle = ((x / 2 + y / 2) & 1) ? '#d2d2d2' : '#e8e8e8'; g.fillRect(x, y, 2, 2); } for (let i = 0; i < 240; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * .12})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); } }));
  weave.repeat.set(2, 2);
  const fabM = {}, fab = col => fabM[col] || (fabM[col] = new T.MeshStandardMaterial({ color: col, map: weave, bumpMap: weave, bumpScale: .2, roughness: .88, metalness: 0 }));
  const featherTex = rep(tex(64, 128, (g, w, h) => { g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = -8; x < w; x += 16) { const o = (y / 8 & 1) ? 8 : 0; g.fillStyle = '#d4d4d4'; g.beginPath(); g.moveTo(x + o, y); g.quadraticCurveTo(x + 8 + o, y + 14, x + 16 + o, y); g.fill(); } for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(rnd() * w, rnd() * h, 1, 5); } }));
  const featM = {}, feather = col => featM[col] || (featM[col] = new T.MeshStandardMaterial({ color: col, map: featherTex, bumpMap: featherTex, bumpScale: .3, roughness: .7 }));
  const metalM = {}, metal = col => metalM[col] || (metalM[col] = new T.MeshStandardMaterial({ color: col, roughness: .38, metalness: .55 }));

  const lockerTex = col => tex(256, 256, (g, w, h) => { // wall lockers: three doors with vents, handles and a little wear
    g.fillStyle = '#0c1436'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x = i * w / 3 + 5, ww = w / 3 - 10, gr = g.createLinearGradient(x, 0, x + ww, 0); gr.addColorStop(0, col); gr.addColorStop(.5, '#ffffff44'); gr.addColorStop(1, col);
      g.fillStyle = col; g.fillRect(x, 8, ww, h - 16); g.fillStyle = gr; g.globalAlpha = .4; g.fillRect(x, 8, ww, h - 16); g.globalAlpha = 1;
      g.fillStyle = '#0006'; for (let v = 0; v < 6; v++) g.fillRect(x + 12, 22 + v * 9, ww - 24, 4);
      g.strokeStyle = '#00000055'; g.lineWidth = 2; g.strokeRect(x + 6, 80, ww - 12, h - 110);
      g.fillStyle = '#0004'; g.fillRect(x, 8, ww, 4); g.fillStyle = '#ffffff55'; g.fillRect(x, h - 20, ww, 3);
      g.fillStyle = '#e8eefc'; g.fillRect(x + ww - 18, h * .52, 7, 26); g.fillStyle = '#0004'; g.fillRect(x + ww - 11, h * .52, 2, 26);
      g.fillStyle = '#ffffffaa'; g.fillRect(x + 14, 62, 22, 10);
      for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${rnd() * .12})`; g.fillRect(x + rnd() * ww, 8 + rnd() * (h - 16), 1 + rnd() * 6, 1); }
    }
  });
  const doorTex = (col, seed) => tex(256, 400, (g, w, h) => { // the big obstacle: a bank of two tall lockers, metal with vents, handle, lock and a number plate
    g.fillStyle = '#10183c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2; i++) {
      const x = i * w / 2 + 4, ww = w / 2 - 8, gr = g.createLinearGradient(x, 0, x + ww, 0); gr.addColorStop(0, col); gr.addColorStop(.35, '#ffffff66'); gr.addColorStop(.55, col); gr.addColorStop(1, '#00000066');
      g.fillStyle = col; g.fillRect(x, 6, ww, h - 12); g.fillStyle = gr; g.globalAlpha = .55; g.fillRect(x, 6, ww, h - 12); g.globalAlpha = 1;
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${rnd() * .05})`; g.fillRect(x, y, ww, 1); }
      g.fillStyle = '#00000088'; for (let v = 0; v < 9; v++) g.fillRect(x + 20, 26 + v * 11, ww - 40, 5);
      g.fillStyle = '#ffffff33'; for (let v = 0; v < 9; v++) g.fillRect(x + 20, 31 + v * 11, ww - 40, 1.5);
      g.strokeStyle = '#00000066'; g.lineWidth = 3; g.strokeRect(x + 8, 140, ww - 16, h - 190); g.strokeStyle = '#ffffff33'; g.lineWidth = 1; g.strokeRect(x + 10, 142, ww - 20, h - 194);
      g.fillStyle = '#f2f6ff'; g.fillRect(x + ww - 26, h * .5 - 14, 9, 52); g.fillStyle = '#0005'; g.fillRect(x + ww - 17, h * .5 - 14, 3, 52);
      g.fillStyle = '#c8d0e4'; g.beginPath(); g.arc(x + ww - 22, h * .5 + 64, 7, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillRect(x + ww - 24, h * .5 + 62, 4, 7);
      g.fillStyle = '#e8eefc'; g.fillRect(x + 18, 108, 42, 22); g.fillStyle = '#233'; g.font = '700 16px system-ui'; g.textAlign = 'center'; g.fillText(String(214 + i * 3 + seed), x + 39, 125);
      for (let n = 0; n < 70; n++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${rnd() * .16})`; g.fillRect(x + rnd() * ww, 6 + rnd() * (h - 12), 1 + rnd() * 9, 1 + rnd() * 2); }
      g.fillStyle = '#0003'; g.beginPath(); g.ellipse(x + ww * .3, h * .7, 14, 9, .5, 0, 7); g.fill();
    }
    g.fillStyle = '#0008'; g.fillRect(w / 2 - 2, 0, 4, h);
  });
  const labelTex = (text, bg, fg, w = 512, h = 160, size = 76, stripes) => tex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); if (stripes) { g.fillStyle = stripes; for (let x = -h; x < w; x += 44) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 22, h); g.lineTo(x + 22 + 26, h - 26); g.lineTo(x + 26, h - 26); g.fill(); } }
    g.fillStyle = fg; g.font = `900 ${size}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 - (stripes ? 8 : 0));
  });
  const tileTex = tex(512, 178, (g, w, h) => { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${rnd() * .06})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 10, 1 + rnd() * 2); } g.strokeStyle = 'rgba(0,0,30,.35)'; g.lineWidth = 3; for (let x = 0; x <= w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y <= h; y += h / 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } });
  const coinTex = tex(128, 128, (g) => { g.fillStyle = '#ffb81c'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.strokeStyle = '#c47d00'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke(); g.fillStyle = '#c47d00'; g.font = '900 64px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', 64, 68); });
  const blobTex = tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(0,0,0,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const blob = (s) => { const o = mesh(G('blob', () => new T.PlaneGeometry(1, 1)), blobMat); o.rotation.x = -Math.PI / 2; o.scale.set(s, s, 1); o.position.y = .03; return o; };

  /* ---------- a backpack: rounded fabric body, front pocket, zipper, straps, handle, bottle pocket ---------- */
  function mkPack(col, accent, s = 1) {
    const g = grp(
      cap(.34, .42, fab(col), 0, .52, 0, 1.15, 1, .62), cap(.27, .16, fab(accent), 0, .36, .27, 1.1, .85, .48),
      box(.5, .025, .03, 0xe8eefc, 0, .5, .31), box(.06, .05, .05, 0xc8d0e4, .26, .5, .31),
      mesh(G('handle', () => new T.TorusGeometry(.11, .028, 8, 16, Math.PI)), mat(0x141a30), 0, .98, 0),
      cyl(.09, .09, .42, 0x9ad0ff, .5, .34, .02), cyl(.07, .07, .05, 0x1b4fd8, .5, .58, .02),
      box(.07, .5, .04, 0x141a30, -.22, .55, -.2), box(.07, .5, .04, 0x141a30, .22, .55, -.2));
    g.scale.setScalar(s); return g;
  }
  function mkBags() { // a pile of backpacks and books: low enough to jump
    const g = new T.Group();
    const a = mkPack(0xe03a5a, 0xa81f3c, 1.0); a.position.set(-.5, 0, .1); a.rotation.y = .25; g.add(a);
    const b = mkPack(0x2f6bff, 0x1b3fa0, 1.0); b.position.set(.45, 0, -.1); b.rotation.y = -.4; g.add(b);
    const c = mkPack(0xf5a623, 0xc47d00, .85); c.position.set(0, .7, 0); c.rotation.set(0, .15, .08); g.add(c);
    g.add(box(.85, .1, .6, fab(0x2fb26a), .1, 1.25, .35), box(.8, .1, .56, fab(0x8a5a2b), .1, 1.35, .35), box(.76, .1, .52, fab(0xffffff), .1, 1.45, .35)); g.userData.h = 1.5; return g;
  }

  /* ---------- the big obstacle: a tall bank of lockers (too tall to jump, change lanes) ---------- */
  function mkLockerBank(col, seed) {
    const front = new T.MeshStandardMaterial({ map: doorTex(col, seed), roughness: .42, metalness: .35 }), body = metal(0x1a2a60), top = metal(0x0f1a40);
    const g = grp(mesh(G('lk', () => new T.BoxGeometry(2.1, 3.1, 1.1)), [body, body, top, body, front, body], 0, 1.7, 0), box(2.2, .15, 1.2, 0x0a1230, 0, .08, 0), box(2.14, .1, 1.14, 0x0f1a40, 0, 3.27, 0));
    g.userData.h = 3.3; return g;
  }

  const signMat = new T.MeshStandardMaterial({ map: labelTex('HALL CLOSED', '#e0233f', '#ffffff', 512, 160, 74, '#ffd24a'), roughness: .5, metalness: .1 });
  function mkSign() { // a hanging barrier: slide under it
    const g = grp(mesh(G('signb', () => new T.BoxGeometry(2.2, 1.05, .16)), [metal(0x8a1224), metal(0x8a1224), metal(0xb91a33), metal(0x8a1224), signMat, signMat], 0, 2.2, 0), cyl(.04, .04, CEIL - 2.7, 0x9aa7c7, -.95, 2.7 + (CEIL - 2.7) / 2, 0, 8), cyl(.04, .04, CEIL - 2.7, 0x9aa7c7, .95, 2.7 + (CEIL - 2.7) / 2, 0, 8), box(2.3, .08, .2, 0xffd24a, 0, 1.68, 0)); g.userData.h = 2.7; return g;
  }
  const coinGeo = new T.CylinderGeometry(.5, .5, .14, 28), coinFace = new T.MeshStandardMaterial({ map: coinTex, emissive: 0x553300, roughness: .35, metalness: .4 }), coinMats = [metal(0xe29a00), coinFace, coinFace];
  function mkCoin() { const c = mesh(coinGeo, coinMats); c.rotation.x = Math.PI / 2; const g = grp(c); g.userData.spin = c; return g; }
  function mkMagnet() { const g = new T.Group(); const u = mesh(G('mag', () => new T.TorusGeometry(.42, .15, 12, 20, Math.PI)), metal(0xff3b52)); u.rotation.z = Math.PI; g.add(u, cyl(.15, .15, .22, metal(0xf2f6ff), -.42, .1, 0), cyl(.15, .15, .22, metal(0xf2f6ff), .42, .1, 0)); return g; }
  function mkShield() { const g = new T.Group(); const s = mesh(G('shd', () => new T.SphereGeometry(.52, 20, 16)), new T.MeshStandardMaterial({ color: 0x4cc9ff, emissive: 0x0a4a66, roughness: .2, metalness: .2, transparent: true, opacity: .85 })); const r = mesh(G('shr', () => new T.TorusGeometry(.6, .05, 8, 28)), mat(0xffffff)); g.add(s, r); return g; }
  const TPL = { lockB: mkLockerBank('#2f6bff', 0), lockG: mkLockerBank('#14c46f', 5), bags: mkBags(), sign: mkSign(), coin: mkCoin(), magnet: mkMagnet(), shield: mkShield() };
  const clone = k => { const g = TPL[k].clone(); g.userData = { ...TPL[k].userData }; if (k === 'coin') g.userData.spin = g.children[0]; return g; };

  /* ---------- the mascot: an osprey with rounded body, feathered wings, talons and a textured backpack ---------- */
  function mkRunner() {
    const R = {}, root = new T.Group(), body = new T.Group(); root.add(body); R.root = root; R.body = body;
    const blue = fab(0x1b4fd8), green = fab(0x14c46f), white = feather(0xf4f7ff), navy = feather(0x0b2a6b), gold = new T.MeshStandardMaterial({ color: 0xf5a623, roughness: .45 });
    body.add(cap(.4, .38, blue, 0, 1.42, 0, 1, 1, .78), cap(.3, .3, white, 0, 1.38, -.22, 1, 1, .4), sph(.46, green, 0, 1.0, .02, 1, .62, .8));
    const pack = grp(cap(.3, .34, fab(0xf5a623), 0, 0, 0, 1.15, 1, .6), cap(.22, .12, fab(0xc47d00), 0, -.18, .2, 1.1, .85, .5), box(.44, .02, .03, 0xfff0c0, 0, -.14, .3), box(.06, .5, .04, 0x141a30, -.25, .02, -.17), box(.06, .5, .04, 0x141a30, .25, .02, -.17)); pack.position.set(0, 1.5, .4); body.add(pack);
    const head = new T.Group(); head.position.set(0, 2.2, 0); body.add(head); R.head = head;
    const beak = cyl(0, .13, .4, gold, 0, -.05, -.47, 12); beak.rotation.x = -Math.PI / 2;
    head.add(sph(.4, white, 0, 0, 0, 1, .95, 1), sph(.36, navy, 0, .1, .1, 1, .8, 1), beak, box(.1, .07, .1, 0xffd24a, -.18, .08, -.34), box(.1, .07, .1, 0xffd24a, .18, .08, -.34), box(.78, .17, .52, navy, 0, .1, -.06), sph(.05, 0x111111, -.18, .08, -.4), sph(.05, 0x111111, .18, .08, -.4));
    body.add(box(.5, .1, .5, navy, 0, .96, .45), box(.36, .08, .4, navy, 0, .92, .62));
    const mkLeg = x => { const hip = new T.Group(); hip.position.set(x, 1.0, 0); const th = cap(.14, .3, green, 0, -.27, 0), knee = new T.Group(); knee.position.set(0, -.55, 0); knee.add(cap(.1, .3, gold, 0, -.25, 0), box(.3, .08, .3, gold, 0, -.5, -.1), box(.07, .06, .26, gold, -.1, -.5, -.3), box(.07, .06, .26, gold, .1, -.5, -.3), box(.07, .06, .26, gold, 0, -.5, -.32)); hip.add(th, knee); hip.userData.knee = knee; body.add(hip); return hip; };
    const mkArm = x => { const sh = new T.Group(); sh.position.set(x * 1.0, 1.78, 0); sh.add(cap(.11, .38, navy, x * .12, -.3, 0)); const el = new T.Group(); el.position.set(x * .12, -.62, 0);
      for (let i = 0; i < 4; i++) { const f = box(.07 + i * .01, .46 - i * .05, .3, i % 2 ? navy : fab(0x1b4fd8), x * (.04 + i * .09), -.3 + i * .02, .02 + i * .02); f.rotation.z = -x * (.04 + i * .05); el.add(f); }
      el.add(sph(.1, white, 0, -.56, 0)); sh.add(el); sh.userData.el = el; body.add(sh); return sh; };
    R.legL = mkLeg(-.22); R.legR = mkLeg(.22); R.armL = mkArm(-.5); R.armR = mkArm(.5);
    R.shadow = blob(2.2); root.add(R.shadow); R.shield = mesh(G('shld', () => new T.SphereGeometry(1.45, 20, 14)), new T.MeshBasicMaterial({ color: 0x5bd0ff, transparent: true, opacity: .2, depthWrite: false }), 0, 1.3, 0); R.shield.visible = false; root.add(R.shield);
    R.mring = mesh(G('mrg', () => new T.TorusGeometry(1.7, .035, 6, 40)), new T.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: .55 }), 0, 1.3, 0); R.mring.rotation.x = Math.PI / 2; R.mring.visible = false; root.add(R.mring);
    return R;
  }
  const HIP = 1.0;
  function pose(R, now, sp, air, slide, jk, land, lean, tum) {
    land = land || 0; lean = lean || 0; const p = now / 1000 * (7.5 + 3.4 * sp), body = R.body, root = R.root, airborne = air > 2, sl = slide || 0;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); R.head.rotation.set(0, 0, 0);
    let thL, thR, knL, knR, aw = 0, el = .5;
    if (airborne) { // leap: one knee driven up, wings spread and flapping
      const k = clamp(jk == null ? .5 : jk, 0, 1), flap = Math.sin(now / 70) * .22;
      thL = .95; knL = 1.25; thR = -.25; knR = .5; aw = 1.25 + flap; body.rotation.x = -.12 + (k > .6 ? .22 * (k - .6) : 0); el = .15; R.armL.rotation.x = R.armR.rotation.x = -.4;
    } else {
      const a = Math.sin(p), ca = Math.cos(p), cb = -ca;
      thL = a * .95; thR = -a * .95; knL = .2 + Math.max(0, ca) * 1.15; knR = .2 + Math.max(0, cb) * 1.15; aw = .08 + .06 * Math.abs(a); el = .9;
      body.position.y = Math.abs(ca) * .16 - .06; body.rotation.x = -.16; body.rotation.y = a * .1; body.rotation.z = a * .05; R.head.rotation.x = .16; R.head.rotation.y = -a * .08;
      R.armL.rotation.x = -a; R.armR.rotation.x = a;
    }
    R.legL.rotation.x = thL; R.legR.rotation.x = thR; R.legL.userData.knee.rotation.x = -knL; R.legR.userData.knee.rotation.x = -knR;
    R.armL.rotation.z = -aw; R.armR.rotation.z = aw; R.armL.userData.el.rotation.x = -el; R.armR.userData.el.rotation.x = -el;
    if (sl > .02) { // a belly-first dive slide: body flat and low, arms thrown forward, feet trailing, backpack on top so it never clips the floor
      const th = -sl * 1.38, hipY = HIP + (.42 - HIP) * sl; body.rotation.x = th; body.position.y = hipY - HIP * Math.cos(th); body.position.z = -HIP * Math.sin(th); body.rotation.z = Math.sin(now / 90) * .02 * sl; body.rotation.y = 0;
      R.legL.rotation.x = thL * (1 - sl) - sl * .12; R.legR.rotation.x = thR * (1 - sl) + sl * .1; R.legL.userData.knee.rotation.x = -knL * (1 - sl) - sl * .15; R.legR.userData.knee.rotation.x = -knR * (1 - sl) - sl * .35;
      R.armL.rotation.x = R.armL.rotation.x * (1 - sl) + sl * 2.95; R.armR.rotation.x = R.armR.rotation.x * (1 - sl) + sl * 2.95; R.armL.rotation.z = -.28 * sl; R.armR.rotation.z = .28 * sl; R.armL.userData.el.rotation.x = R.armR.userData.el.rotation.x = -.1 * sl;
      R.head.rotation.x = sl * 1.05;
    }
    root.rotation.set(0, -lean * 1.1, -lean * .9);
    const sy = 1 - .2 * land + (airborne && jk != null && jk < .25 ? .12 : 0), sxz = 1 + .1 * land - (airborne && jk != null && jk < .25 ? .05 : 0);
    root.scale.set(sxz, sy, sxz); if (tum) { root.rotation.x = tum.rot; root.scale.multiplyScalar(tum.sc); }
  }

  /* ---------- the hallway ---------- */
  window.Dash3D = function (canvas, W, H) {
    let renderer; try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; }
    if (!renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(W, H, false);
    const sky = new T.Color(0x050a1f), scene = new T.Scene(); scene.background = sky; scene.fog = new T.Fog(sky, 26, ROW * AHEAD - 4);
    scene.add(new T.HemisphereLight(0xb4c6ff, 0x1a2550, 1.0)); const sun = new T.DirectionalLight(0xdfe9ff, .75); sun.position.set(3, 9, 6); scene.add(sun); const rim = new T.DirectionalLight(0x4f86ff, .35); rim.position.set(-4, 4, -6); scene.add(rim);
    const cam = new T.PerspectiveCamera(52, W / H, .3, 120), world = new T.Group(); scene.add(world);
    const LEN = ROW * (AHEAD + 8), midZ = -LEN / 2 + 8;
    const shell = (w, h, col, x, y, z, ry) => { const o = mesh(G(`p${w},${h}`, () => new T.PlaneGeometry(w, h)), mat(col), x, y, z); o.rotation.y = ry; world.add(o); return o; };
    shell(LEN, CEIL - 3.3, 0x0d1534, -WALL, 3.3 + (CEIL - 3.3) / 2, midZ, Math.PI / 2); shell(LEN, CEIL - 3.3, 0x0d1534, WALL, 3.3 + (CEIL - 3.3) / 2, midZ, -Math.PI / 2);
    for (const sd of [-1, 1]) world.add(mesh(G('stripe', () => new T.BoxGeometry(.12, .22, LEN)), new T.MeshBasicMaterial({ color: 0x14c46f }), sd * (WALL - .06), 3.4, midZ));
    const lockerMats = [0x2f6bff, 0x14c46f].map(c => new T.MeshStandardMaterial({ map: lockerTex('#' + c.toString(16).padStart(6, '0')), roughness: .5, metalness: .25 }));
    const floorMats = [0x161f4a, 0x111838].map(c => new T.MeshStandardMaterial({ color: c, map: tileTex, roughness: .5, metalness: .1 })), lineMat = new T.MeshBasicMaterial({ color: 0x3d6bff });
    const tintMats = { 1: new T.MeshBasicMaterial({ color: 0xff3c50, transparent: true, opacity: .2, depthWrite: false }), 2: new T.MeshBasicMaterial({ color: 0xffc828, transparent: true, opacity: .24, depthWrite: false }), 3: new T.MeshBasicMaterial({ color: 0x3cc8ff, transparent: true, opacity: .24, depthWrite: false }) };
    const floorGeo = new T.PlaneGeometry(WALL * 2, ROW), laneGeo = new T.PlaneGeometry(LANE - .16, ROW * .98), lockGeo = new T.PlaneGeometry(ROW, 3.3), pool = [];
    for (let i = 0; i < POOL; i++) {
      const g = new T.Group(); world.add(g); const s = { g, r: -99, kids: [], floor: mesh(floorGeo, floorMats[0]), tints: [], lockL: mesh(lockGeo, lockerMats[0]), lockR: mesh(lockGeo, lockerMats[0]) };
      s.floor.rotation.x = -Math.PI / 2; g.add(s.floor);
      for (let l = 0; l < 3; l++) { const t = mesh(laneGeo, tintMats[1], (l - 1) * LANE, .02, 0); t.rotation.x = -Math.PI / 2; t.visible = false; g.add(t); s.tints.push(t); }
      for (const x of [-1.5, -.5, .5, 1.5]) g.add(mesh(G('ll', () => new T.BoxGeometry(.1, .02, ROW)), lineMat, x * LANE, .03, 0));
      s.lockL.position.set(-WALL + .01, 1.65, 0); s.lockL.rotation.y = Math.PI / 2; s.lockR.position.set(WALL - .01, 1.65, 0); s.lockR.rotation.y = -Math.PI / 2; g.add(s.lockL, s.lockR);
      g.add(box(.5, .35, ROW, 0x0a1230, -WALL + .25, .18, 0), box(.5, .35, ROW, 0x0a1230, WALL - .25, .18, 0)); pool.push(s);
    }
    const mkArch = text => { const lm = new T.MeshLambertMaterial({ map: labelTex(text, '#101c52', '#ffd24a', 768, 160, 68) }); return grp(mesh(G('archb', () => new T.BoxGeometry(WALL * 2, 1.5, .3)), lm, 0, 5.8, 0), box(.4, 6, .4, 0xffd24a, -WALL + .2, 3, 0), box(.4, 6, .4, 0xffd24a, WALL - .2, 3, 0)); };
    const arches = {}, archFor = r => arches[r] || (arches[r] = mkArch(['LEVEL 2 · SOPHOMORE', 'LEVEL 3 · JUNIOR', 'LEVEL 4 · SENIOR'][r / 100 - 1]));
    const vaultMat = new T.MeshLambertMaterial({ map: tex(512, 640, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.6, '#ffc542'); gr.addColorStop(1, '#c78600'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(120,70,0,.25)'; g.fillRect(24, 24, w - 48, h - 48); g.fillStyle = '#6b3d00'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '200px system-ui'; g.fillText('🎓', w / 2, 200); g.font = '900 96px system-ui'; g.fillText('CLASS', w / 2, 380); g.font = '900 52px system-ui'; g.fillText('JACKPOT +500', w / 2, 480); }), emissive: 0x442a00 });
    const vault = grp(box(WALL * 2, CEIL, .4, 0x141e44, 0, CEIL / 2, -.3), mesh(G('vd', () => new T.BoxGeometry(5.6, 6.2, .3)), vaultMat, 0, 3.1, 0)); vault.visible = false; world.add(vault);
    const foot = new T.Vector3(), out = { x: VX, y: 468 };

    function assign(s, r, rows) {
      s.r = r; s.kids.forEach(k => s.g.remove(k)); s.kids = []; const row = rows[r], par = ((r & 1) + 2) & 1;
      s.floor.material = floorMats[par]; s.lockL.material = s.lockR.material = lockerMats[((r % 2) + 2) % 2];
      for (let l = 0; l < 3; l++) { let kind = 0; for (let b = 1; b <= 3; b++) { const n = rows[r + b]; if (!n) continue; kind = (n[0] >> l & 1) ? 1 : (n[2] >> l & 1) ? 2 : (n[3] >> l & 1) ? 3 : kind; if (kind) break; } const t = s.tints[l]; t.visible = !!kind; if (kind) t.material = tintMats[kind]; }
      s.coin = s.power = null;
      if (r === 100 || r === 200 || r === 300) { const a = archFor(r); a.position.z = 0; s.g.add(a); s.kids.push(a); }
      if (!row || r < 1) return;
      for (let l = 0; l < 3; l++) { const x = (l - 1) * LANE, z = .4 * ROW; let o = null;
        if (row[0] >> l & 1) o = clone((r + l) & 1 ? 'lockB' : 'lockG'); else if (row[2] >> l & 1) o = clone('bags'); else if (row[3] >> l & 1) o = clone('sign');
        if (o) { o.position.set(x, 0, z); s.g.add(o); s.kids.push(o); if (o.userData.h < 3) { const b = blob(2.2); b.position.set(x, .03, z); s.g.add(b); s.kids.push(b); } }
        if (row[1] === l) { const c = clone('coin'); c.position.set(x, 1.3, z); s.g.add(c); s.kids.push(c); s.coin = c; }
        if (row[4] >= 0 && Math.floor(row[4] / 10) === l) { const p = clone(row[4] % 10 === 1 ? 'magnet' : 'shield'); p.position.set(x, 1.3, z); s.g.add(p); s.kids.push(p); s.power = p; } }
    }

    const R = mkRunner(); world.add(R.root);
    function frame(run, rp, now, crashed, tum, sp) {
      const base = Math.floor(rp) - 5, rows = run.rows;
      for (let r = base; r < base + POOL; r++) { const s = pool[((r % POOL) + POOL) % POOL]; if (s.r !== r || (r < rows.length && !s.hadRow && rows[r])) { assign(s, r, rows); s.hadRow = !!rows[r]; } s.g.position.z = -(r - rp + .5) * ROW;
        if (s.coin) { s.coin.visible = !run.got.has(r); s.coin.userData.spin.rotation.z = now / 260 + r; s.coin.position.y = 1.35 + Math.sin(now / 280 + r) * .12; }
        if (s.power) { s.power.visible = !run.got.has(-r); s.power.rotation.y = now / 420; s.power.position.y = 1.3 + Math.sin(now / 300) * .14; } }
      const toEnd = run.max + 1 - rp; vault.visible = toEnd < AHEAD + 3; vault.position.z = -toEnd * ROW;
      const wx = (run.laneX - VX) / LANEPX * LANE, lean = clamp((run.target - run.laneX) / 70, -1, 1), air = run.air / 78 * 1.8;
      R.root.position.set(wx, air, 0); pose(R, now, sp, run.air, run.slide, run.jk, run.land, lean, tum);
      const sh = 1 - Math.min(.5, air / 4.5); R.shadow.scale.set(2.2 * sh, 2.2 * sh, 1); R.shadow.position.y = .04 - air; R.shadow.rotation.set(-Math.PI / 2, 0, 0);
      R.shield.visible = !!run.shield; R.shield.scale.setScalar(1 + Math.sin(now / 120) * .03); R.mring.visible = run.magnetUntil >= Math.floor(rp); R.mring.rotation.z = now / 500;
      let sx = 0, sy = 0; if (run.shakeUntil > now) { sx = (Math.random() - .5) * run.amp * .03; sy = (Math.random() - .5) * run.amp * .03; }
      const cx = wx * .6 + sx, cy = 6.9 - run.slide * .5 + air * .2 + sy; cam.position.set(cx, cy, 9.4); cam.lookAt(wx * .35, .7, -3.5); cam.rotation.z += -lean * .035;
      const fovT = 52 + Math.max(0, sp - 1) * 3; if (Math.abs(cam.fov - fovT) > .1) { cam.fov = fovT; cam.updateProjectionMatrix(); }
      renderer.render(scene, cam); cam.updateMatrixWorld(); foot.set(wx, .05, 0).project(cam); out.x = (foot.x * .5 + .5) * W; out.y = (-foot.y * .5 + .5) * H; return out;
    }
    return { frame, renderer, dispose() { renderer.dispose(); } };
  };
})();
