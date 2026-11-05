/* Hallway Dash in real 3D (three.js). Only draws the world; app.js keeps the game rules, the HUD and the effects.
   World units: the runner stands at z = 0 and the hallway runs toward -z. One row = ROW units. */
(function () {
  const T = window.THREE; if (!T) return;
  const LANE = 2.6, ROW = 3.4, WALL = 4.9, CEIL = 4.7, AHEAD = 20, POOL = AHEAD + 6, VX = 200, LANEPX = 122;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mats = {}, mat = (col, extra) => { const k = col + (extra ? JSON.stringify(extra) : ''); return mats[k] || (mats[k] = new T.MeshLambertMaterial({ color: col, ...extra })); };
  const geos = {}, G = (k, f) => geos[k] || (geos[k] = f());
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); return o; };
  const box = (w, h, d, col, x, y, z) => mesh(G(`b${w},${h},${d}`, () => new T.BoxGeometry(w, h, d)), mat(col), x, y, z);
  const cyl = (rt, rb, h, col, x, y, z, seg = 14) => mesh(G(`c${rt},${rb},${h},${seg}`, () => new T.CylinderGeometry(rt, rb, h, seg)), mat(col), x, y, z);
  const sph = (r, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = mesh(G(`s${r}`, () => new T.SphereGeometry(r, 16, 12)), mat(col), x, y, z); o.scale.set(sx, sy, sz); return o; };
  const grp = (...kids) => { const g = new T.Group(); kids.forEach(k => k && g.add(k)); return g; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.anisotropy = 4; return t; };

  const lockerTex = col => tex(256, 256, (g, w, h) => { // three locker doors with vents and handles
    g.fillStyle = '#233a78'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x = i * w / 3 + 5, ww = w / 3 - 10; const gr = g.createLinearGradient(x, 0, x + ww, 0); gr.addColorStop(0, col); gr.addColorStop(.5, '#ffffff55'); gr.addColorStop(1, col);
      g.fillStyle = col; g.fillRect(x, 8, ww, h - 16); g.fillStyle = gr; g.globalAlpha = .35; g.fillRect(x, 8, ww, h - 16); g.globalAlpha = 1;
      g.fillStyle = '#0006'; for (let v = 0; v < 5; v++) g.fillRect(x + 12, 24 + v * 10, ww - 24, 4);
      g.fillStyle = '#0004'; g.fillRect(x, 8, ww, 4); g.fillStyle = '#ffffff44'; g.fillRect(x, h - 20, ww, 4);
      g.fillStyle = '#e8eefc'; g.fillRect(x + ww - 18, h * .5, 7, 26); g.fillStyle = '#0003'; g.fillRect(x + ww - 11, h * .5, 2, 26);
    }
  });
  const labelTex = (text, bg, fg, w = 512, h = 160, size = 76, stripes) => tex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); if (stripes) { g.fillStyle = stripes; for (let x = -h; x < w; x += 44) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 22, h); g.lineTo(x + 22 + 26, h - 26); g.lineTo(x + 26, h - 26); g.fill(); } }
    g.fillStyle = fg; g.font = `900 ${size}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 - (stripes ? 8 : 0));
  });
  const coinTex = tex(128, 128, (g) => { g.fillStyle = '#ffb81c'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.strokeStyle = '#c47d00'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke(); g.fillStyle = '#c47d00'; g.font = '900 64px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', 64, 68); });
  const blobTex = tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const blob = (s) => { const o = mesh(G('blob', () => new T.PlaneGeometry(1, 1)), blobMat); o.rotation.x = -Math.PI / 2; o.scale.set(s, s, 1); o.position.y = .03; return o; };

  /* ---------- obstacles and pickups (built once, cloned per row) ---------- */
  function mkCart() { // a rolling janitor cart: too big to jump, change lanes
    const g = grp(box(1.9, .12, 1.5, 0x2a3558, 0, .45, 0), box(1.9, 1.0, 1.5, 0x2f6bff, 0, 1.0, 0), box(1.95, .1, 1.55, 0xdce6ff, 0, 1.55, 0), box(1.8, .5, 1.4, 0xffc542, 0, 1.85, 0), box(.1, 1.7, .1, 0x9aa7c7, .85, 1.55, .72), box(.1, 1.7, .1, 0x9aa7c7, -.85, 1.55, .72), box(1.8, .1, .1, 0x9aa7c7, 0, 2.4, .72), box(1.2, .5, .06, 0xffffff, 0, 1.0, -.76));
    for (const x of [-.75, .75]) for (const z of [-.6, .6]) { const w = cyl(.22, .22, .16, 0x151a2e, x, .3, z); w.rotation.z = Math.PI / 2; g.add(w); }
    g.add(box(1.5, .14, .1, 0xff3b52, 0, 1.25, -.78)); g.userData.h = 2.4; return g;
  }
  function mkBags() { // a pile of backpacks and a stack of books: jump over
    const g = new T.Group(), cols = [0xff5470, 0x3d8bff, 0x35d07f];
    [[-.45, 0, .05, .0, 0xff5470], [.4, 0, -.1, .4, 0x3d8bff], [0, .78, 0, .2, 0xffc542]].forEach(([x, y, z, r, c]) => { const b = grp(box(.9, 1.0, .6, c, 0, .5, 0), box(.7, .45, .2, c === 0xffc542 ? 0xd99a00 : 0x1a2547, 0, .35, .38), box(.55, .12, .06, 0xffffff, 0, .78, .31)); b.position.set(x, y, z); b.rotation.y = r; g.add(b); });
    g.add(box(.9, .12, .65, 0x8a5a2b, .1, 1.34, .1), box(.8, .12, .6, 0x2fb26a, .1, 1.46, .1)); return g;
  }
  const signMat = new T.MeshLambertMaterial({ map: labelTex('HALL CLOSED', '#e0233f', '#ffffff', 512, 160, 74, '#ffd24a') });
  function mkSign() { // a hanging barrier: slide under it
    const g = grp(mesh(G('signb', () => new T.BoxGeometry(2.2, 1.05, .16)), [mat(0x8a1224), mat(0x8a1224), mat(0xb91a33), mat(0x8a1224), signMat, signMat], 0, 2.2, 0), box(.07, CEIL - 2.7, .07, 0x9aa7c7, -.95, 2.7 + (CEIL - 2.7) / 2, 0), box(.07, CEIL - 2.7, .07, 0x9aa7c7, .95, 2.7 + (CEIL - 2.7) / 2, 0), box(2.3, .08, .2, 0xffd24a, 0, 1.68, 0)); g.userData.h = 2.7; return g;
  }
  const coinGeo = new T.CylinderGeometry(.5, .5, .14, 28), coinMats = [mat(0xe29a00), new T.MeshLambertMaterial({ map: coinTex, emissive: 0x553300 }), new T.MeshLambertMaterial({ map: coinTex, emissive: 0x553300 })];
  function mkCoin() { const c = mesh(coinGeo, coinMats); c.rotation.x = Math.PI / 2; const g = grp(c); g.userData.spin = c; g.userData.f = 1; return g; }
  function mkMagnet() { const g = new T.Group(); const u = mesh(G('mag', () => new T.TorusGeometry(.42, .15, 10, 18, Math.PI)), mat(0xff3b52)); u.rotation.z = Math.PI; g.add(u, cyl(.15, .15, .22, 0xf2f6ff, -.42, .1, 0), cyl(.15, .15, .22, 0xf2f6ff, .42, .1, 0)); g.position.y = 0; g.userData.f = 1; return g; }
  function mkShield() { const g = new T.Group(); const s = mesh(G('shd', () => new T.SphereGeometry(.52, 18, 14)), new T.MeshLambertMaterial({ color: 0x4cc9ff, emissive: 0x0a4a66, transparent: true, opacity: .85 })); const r = mesh(G('shr', () => new T.TorusGeometry(.6, .05, 8, 28)), mat(0xffffff)); g.add(s, r); g.userData.f = 1; g.userData.ring = r; return g; }
  const TPL = { cart: mkCart(), bags: mkBags(), sign: mkSign(), coin: mkCoin(), magnet: mkMagnet(), shield: mkShield() };
  const clone = k => { const g = TPL[k].clone(); g.userData = { ...TPL[k].userData }; if (k === 'coin') g.userData.spin = g.children[0]; if (k === 'shield') g.userData.ring = g.children[1]; return g; };

  /* ---------- the mascot: an osprey built from simple shapes, with a real run cycle ---------- */
  function mkRunner() {
    const R = {}, root = new T.Group(), body = new T.Group(); root.add(body); R.root = root; R.body = body;
    const blue = 0x1b4fd8, navy = 0x14c46f, white = 0xf4f7ff, brown = 0x0b2a6b, gold = 0xf5a623, orange = 0xf5a623;
    body.add(box(.78, .9, .5, blue, 0, 1.45, 0), box(.52, .62, .12, white, 0, 1.4, -.28), box(.8, .22, .52, navy, 0, 1.06, 0));
    const pack = grp(box(.7, .8, .32, gold, 0, 0, 0), box(.5, .3, .1, 0xd99a00, 0, -.12, .2), box(.74, .1, .34, 0xffe27a, 0, .38, 0)); pack.position.set(0, 1.5, .42); body.add(pack);
    const head = new T.Group(); head.position.set(0, 2.18, 0); body.add(head); R.head = head;
    head.add(sph(.4, white, 0, 0, 0, 1, .95, 1), sph(.34, brown, 0, .12, .1, 1, .8, 1), cyl(0, .13, .38, gold, 0, -.05, -.46, 10), box(.1, .07, .1, 0xffd24a, -.17, .08, -.34), box(.1, .07, .1, 0xffd24a, .17, .08, -.34), box(.74, .16, .5, 0x0b2a6b, 0, .1, -.08));
    head.children[3].rotation.x = -Math.PI / 2; head.add(box(.7, .08, .05, 0xffc542, 0, .26, -.2));
    body.add(box(.55, .12, .5, brown, 0, 1.02, .42)); // tail feathers
    const mkLeg = x => { const hip = new T.Group(); hip.position.set(x, 1.02, 0); const th = box(.26, .55, .26, navy, 0, -.27, 0); const knee = new T.Group(); knee.position.set(0, -.55, 0); const sh = box(.22, .5, .22, orange, 0, -.25, 0), ft = box(.34, .1, .5, orange, 0, -.5, -.12); knee.add(sh, ft); hip.add(th, knee); hip.userData.knee = knee; body.add(hip); return hip; };
    const mkArm = x => { const sh = new T.Group(); sh.position.set(x * 1.0, 1.78, 0); const arm = grp(box(.2, .62, .3, brown, x * .14, -.31, 0), box(.1, .5, .5, 0x1b4fd8, x * .18, -.36, .1)); const el = new T.Group(); el.position.set(x * .14, -.62, 0); el.add(box(.2, .5, .26, brown, 0, -.25, 0), sph(.14, white, 0, -.55, 0)); sh.add(arm, el); sh.userData.el = el; body.add(sh); return sh; };
    R.legL = mkLeg(-.22); R.legR = mkLeg(.22); R.armL = mkArm(-.46); R.armR = mkArm(.46);
    R.shadow = blob(2.2); root.add(R.shadow); R.shield = mesh(G('shld', () => new T.SphereGeometry(1.45, 20, 14)), new T.MeshBasicMaterial({ color: 0x5bd0ff, transparent: true, opacity: .2, depthWrite: false }), 0, 1.3, 0); R.shield.visible = false; root.add(R.shield);
    R.mring = mesh(G('mrg', () => new T.TorusGeometry(1.7, .035, 6, 40)), new T.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: .55 }), 0, 1.3, 0); R.mring.rotation.x = Math.PI / 2; R.mring.visible = false; root.add(R.mring);
    return R;
  }
  function pose(R, now, sp, air, slide, jk, land, lean, tum) {
    land = land || 0; lean = lean || 0; const p = now / 1000 * (7.5 + 3.4 * sp), body = R.body, root = R.root;
    const airborne = air > 2, sl = slide;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    let thL, thR, knL, knR, ar = 0, aw = 0, el = .5;
    if (airborne) { // leap: one knee driven up, wings spread and flapping
      const k = clamp(jk == null ? .5 : jk, 0, 1), flap = Math.sin(now / 70) * .22;
      thL = .95; knL = 1.25; thR = -.25; knR = .5; ar = -.4; aw = 1.25 + flap; body.rotation.x = -.12 + (k > .6 ? .22 * (k - .6) : 0); el = .15;
    } else {
      const a = Math.sin(p), b = Math.sin(p + Math.PI), ca = Math.cos(p), cb = Math.cos(p + Math.PI);
      thL = a * .95; thR = b * .95; knL = .2 + Math.max(0, ca) * 1.15; knR = .2 + Math.max(0, cb) * 1.15; // knees fold on the forward swing
      ar = -a * 1.0; aw = .08 + .06 * Math.abs(a); el = .9;
      body.position.y = Math.abs(Math.cos(p)) * .16 - .06; body.rotation.x = -.16; body.rotation.y = a * .1; body.rotation.z = a * .05;
      R.head.rotation.x = .16 - .0; R.head.rotation.y = -a * .08;
      R.armR.rotation.x = -(-a) * 1.0; R.armL.rotation.x = -a * 1.0;
    }
    R.legL.rotation.x = thL; R.legR.rotation.x = thR; R.legL.userData.knee.rotation.x = -knL; R.legR.userData.knee.rotation.x = -knR;
    if (airborne || sl) { R.armL.rotation.x = ar; R.armR.rotation.x = ar; }
    R.armL.rotation.z = -aw; R.armR.rotation.z = aw;
    R.armL.userData.el.rotation.x = -el; R.armR.userData.el.rotation.x = -el;
    if (!airborne) { R.armL.rotation.x = -Math.sin(p) * 1.0; R.armR.rotation.x = Math.sin(p) * 1.0; }
    if (sl > .02) { // lie back with the feet out front, under the sign
      body.rotation.x = sl * 1.18; body.position.y = -sl * .5; body.position.z = sl * .35; R.legL.rotation.x = thL * (1 - sl) - sl * .2; R.legR.rotation.x = thR * (1 - sl) - sl * .1; R.legL.userData.knee.rotation.x = -knL * (1 - sl); R.legR.userData.knee.rotation.x = -knR * (1 - sl);
      R.armL.rotation.x = -sl * 1.1; R.armR.rotation.x = -sl * 1.1; R.armL.rotation.z = -.5 * sl; R.armR.rotation.z = .5 * sl; R.head.rotation.x = -sl * .9;
    }
    root.rotation.set(0, -lean * 1.1, -lean * .9); // lean into the lane change
    const sy = 1 - .2 * land + (airborne && jk != null && jk < .25 ? .12 : 0), sxz = 1 + .1 * land - (airborne && jk != null && jk < .25 ? .05 : 0);
    root.scale.set(sxz, sy, sxz);
    if (tum) { root.rotation.x = tum.rot; root.scale.multiplyScalar(tum.sc); }
  }

  /* ---------- the hallway ---------- */
  window.Dash3D = function (canvas, W, H) {
    let renderer; try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; }
    if (!renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(W, H, false);
    const sky = new T.Color(0x050a1f), scene = new T.Scene(); scene.background = sky; scene.fog = new T.Fog(sky, 26, ROW * AHEAD - 4);
    scene.add(new T.HemisphereLight(0xb4c6ff, 0x1a2550, .9)); const sun = new T.DirectionalLight(0xcfe0ff, .55); sun.position.set(3, 9, 6); scene.add(sun);
    const cam = new T.PerspectiveCamera(52, W / H, .3, 120); const world = new T.Group(); scene.add(world);
    // static shell: long walls above the lockers, ceiling, side floor strips
    const LEN = ROW * (AHEAD + 8), midZ = -LEN / 2 + 8;
    const shell = (w, h, col, x, y, z, rx, ry) => { const o = mesh(G(`p${w},${h}`, () => new T.PlaneGeometry(w, h)), mat(col), x, y, z); o.rotation.x = rx || 0; o.rotation.y = ry || 0; world.add(o); return o; };
    shell(LEN, CEIL - 3.3, 0x0d1534, -WALL, 3.3 + (CEIL - 3.3) / 2, midZ, 0, Math.PI / 2).rotation.set(0, Math.PI / 2, 0);
    shell(LEN, CEIL - 3.3, 0x0d1534, WALL, 3.3 + (CEIL - 3.3) / 2, midZ, 0, -Math.PI / 2);
    // gold stripe above the lockers
    for (const sd of [-1, 1]) { const o = mesh(G('stripe', () => new T.BoxGeometry(.12, .22, LEN)), new T.MeshBasicMaterial({ color: 0x14c46f }), sd * (WALL - .06), 3.4, midZ); world.add(o); }
    const lockerMats = [0x2f6bff, 0x14c46f].map(c => new T.MeshLambertMaterial({ map: lockerTex('#' + c.toString(16).padStart(6, '0')) }));
    const floorMats = [0x1a2658, 0x131d46].map(c => mat(c)), tintMats = { 1: new T.MeshBasicMaterial({ color: 0xff3c50, transparent: true, opacity: .2, depthWrite: false }), 2: new T.MeshBasicMaterial({ color: 0xffc828, transparent: true, opacity: .24, depthWrite: false }), 3: new T.MeshBasicMaterial({ color: 0x3cc8ff, transparent: true, opacity: .24, depthWrite: false }) };
    const floorGeo = new T.PlaneGeometry(WALL * 2, ROW), laneGeo = new T.PlaneGeometry(LANE - .16, ROW * .98), lockGeo = new T.PlaneGeometry(ROW, 3.3), lightMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const pool = [], lineMat = new T.MeshBasicMaterial({ color: 0x3d6bff });
    for (let i = 0; i < POOL; i++) {
      const g = new T.Group(); world.add(g); const s = { g, r: -99, kids: [], floor: mesh(floorGeo, floorMats[0]), tints: [], lockL: mesh(lockGeo, lockerMats[0]), lockR: mesh(lockGeo, lockerMats[0]), light: box(.1, .1, .1, 0xffffff, 0, -9, 0), arch: null };
      s.floor.rotation.x = -Math.PI / 2; g.add(s.floor); s.light.material = lightMat; g.add(s.light);
      for (let l = 0; l < 3; l++) { const t = mesh(laneGeo, tintMats[1], (l - 1) * LANE, .02, 0); t.rotation.x = -Math.PI / 2; t.visible = false; g.add(t); s.tints.push(t); }
      for (const x of [-1.5, -.5, .5, 1.5]) g.add(mesh(G('ll', () => new T.BoxGeometry(.1, .02, ROW)), lineMat, x * LANE, .03, 0));
      s.lockL.position.set(-WALL + .01, 1.65, 0); s.lockL.rotation.y = Math.PI / 2; s.lockR.position.set(WALL - .01, 1.65, 0); s.lockR.rotation.y = -Math.PI / 2; g.add(s.lockL, s.lockR);
      g.add(box(.5, .35, ROW, 0x0a1230, -WALL + .25, .18, 0), box(.5, .35, ROW, 0x0a1230, WALL - .25, .18, 0));
      pool.push(s);
    }
    const archMat = new T.MeshLambertMaterial({ map: labelTex('', '#0b1236', '#ffd24a', 512, 128) });
    const mkArch = text => { const lm = new T.MeshLambertMaterial({ map: labelTex(text, '#101c52', '#ffd24a', 768, 160, 68) }); return grp(mesh(G('archb', () => new T.BoxGeometry(WALL * 2, 1.5, .3)), lm, 0, 5.8, 0), box(.4, 6, .4, 0xffd24a, -WALL + .2, 3, 0), box(.4, 6, .4, 0xffd24a, WALL - .2, 3, 0)); };
    const arches = {}; const archFor = r => arches[r] || (arches[r] = mkArch(['LEVEL 2 · SOPHOMORE', 'LEVEL 3 · JUNIOR', 'LEVEL 4 · SENIOR'][r / 100 - 1]));
    // the CLASS door at the end
    const vaultMat = new T.MeshLambertMaterial({ map: tex(512, 640, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.6, '#ffc542'); gr.addColorStop(1, '#c78600'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(120,70,0,.25)'; g.fillRect(24, 24, w - 48, h - 48); g.fillStyle = '#6b3d00'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '200px system-ui'; g.fillText('🎓', w / 2, 200); g.font = '900 96px system-ui'; g.fillText('CLASS', w / 2, 380); g.font = '900 52px system-ui'; g.fillText('JACKPOT +500', w / 2, 480); }), emissive: 0x442a00 });
    const vault = grp(box(WALL * 2, CEIL, .4, 0x141e44, 0, CEIL / 2, -.3), mesh(G('vd', () => new T.BoxGeometry(5.6, 6.2, .3)), vaultMat, 0, 3.1, 0)); vault.visible = false; world.add(vault);
    const foot = new T.Vector3(), out = { x: VX, y: 468 };
    let last = -1;

    function assign(s, r, rows) {
      s.r = r; s.kids.forEach(k => s.g.remove(k)); s.kids = []; const row = rows[r], par = r & 1;
      s.floor.material = floorMats[par]; s.lockL.material = s.lockR.material = lockerMats[((r % 2) + 2) % 2];
      s.light.visible = r % 3 === 0;
      for (let l = 0; l < 3; l++) { let kind = 0; for (let b = 1; b <= 3; b++) { const n = rows[r + b]; if (!n) continue; kind = (n[0] >> l & 1) ? 1 : (n[2] >> l & 1) ? 2 : (n[3] >> l & 1) ? 3 : kind; if (kind) break; } const t = s.tints[l]; t.visible = !!kind; if (kind) t.material = tintMats[kind]; }
      s.coin = s.power = null;
      if (r === 100 || r === 200 || r === 300) { const a = archFor(r); a.position.z = 0; s.g.add(a); s.kids.push(a); }
      if (!row || r < 1) return;
      for (let l = 0; l < 3; l++) { const x = (l - 1) * LANE, z = .4 * ROW; let o = null;
        if (row[0] >> l & 1) o = clone('cart'); else if (row[2] >> l & 1) o = clone('bags'); else if (row[3] >> l & 1) o = clone('sign');
        if (o) { o.position.set(x, 0, z); s.g.add(o); s.kids.push(o); if (!o.userData.h || o.userData.h < 3) { const b = blob(2.0); b.position.set(x, .03, z); s.g.add(b); s.kids.push(b); } }
        if (row[1] === l) { const c = clone('coin'); c.position.set(x, 1.3, z); s.g.add(c); s.kids.push(c); s.coin = c; }
        if (row[4] >= 0 && Math.floor(row[4] / 10) === l) { const p = clone(row[4] % 10 === 1 ? 'magnet' : 'shield'); p.position.set(x, 1.3, z); s.g.add(p); s.kids.push(p); s.power = p; } }
    }

    const R = mkRunner(); world.add(R.root);
    function frame(run, rp, now, crashed, tum, sp) {
      const base = Math.floor(rp) - 5, rows = run.rows;
      for (let r = base; r < base + POOL; r++) { const s = pool[((r % POOL) + POOL) % POOL]; if (s.r !== r || (r < rows.length && !s.hadRow && rows[r]) ) { assign(s, r, rows); s.hadRow = !!rows[r]; } s.g.position.z = -(r - rp + .5) * ROW; s.g.visible = true;
        if (s.coin) { s.coin.visible = !run.got.has(r); s.coin.userData.spin.rotation.z = now / 260 + r; s.coin.position.y = 1.35 + Math.sin(now / 280 + r) * .12; }
        if (s.power) { s.power.visible = !run.got.has(-r); s.power.rotation.y = now / 420; s.power.position.y = 1.3 + Math.sin(now / 300) * .14; } }
      const toEnd = run.max + 1 - rp; vault.visible = toEnd < AHEAD + 3; vault.position.z = -toEnd * ROW;
      const wx = (run.laneX - VX) / LANEPX * LANE, lean = clamp((run.target - run.laneX) / 70, -1, 1), air = run.air / 78 * 1.8;
      R.root.position.set(wx, air, 0); pose(R, now, sp, run.air, run.slide, run.jk, run.land, lean, tum);
      const sh = 1 - Math.min(.5, air / 4.5); R.shadow.scale.set(2.2 * sh, 2.2 * sh, 1); R.shadow.position.y = .04 - air; R.shadow.rotation.set(-Math.PI / 2, 0, 0);
      R.shield.visible = !!run.shield; R.shield.scale.setScalar(1 + Math.sin(now / 120) * .03); R.mring.visible = run.magnetUntil >= Math.floor(rp); R.mring.rotation.z = now / 500;
      // camera: behind and above, easing sideways with the runner, dipping on a slide, shaking on a hit
      let sx = 0, sy = 0; if (run.shakeUntil > now) { sx = (Math.random() - .5) * run.amp * .03; sy = (Math.random() - .5) * run.amp * .03; }
      const cx = wx * .6 + sx, cy = 6.9 - run.slide * .5 + air * .2 + sy; cam.position.set(cx, cy, 9.4); cam.lookAt(wx * .35, .7, -3.5); cam.rotation.z += -lean * .035;
      const fovT = 52 + Math.max(0, sp - 1) * 3; if (Math.abs(cam.fov - fovT) > .1) { cam.fov = fovT; cam.updateProjectionMatrix(); }
      renderer.render(scene, cam);
      cam.updateMatrixWorld(); foot.set(wx, .05, 0).project(cam); out.x = (foot.x * .5 + .5) * W; out.y = (-foot.y * .5 + .5) * H; return out;
    }
    return { frame, renderer, dispose() { renderer.dispose(); } };
  };
})();
