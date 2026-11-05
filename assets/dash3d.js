/* Hallway Dash in real 3D (three.js r160). Only draws the world; app.js keeps the game rules, the HUD and the effects.
   World units: the runner stands at z = 0 and the hallway runs toward -z. One row = ROW units.
   Realistic models (Seahawk, locker bank, backpack pile) load from GLB files made with Higgsfield; until they arrive, or if they fail, simple built-in shapes stand in. */
(function () {
  const T = window.THREE; if (!T) return;
  const LANE = 2.6, ROW = 3.4, WALL = 4.9, CEIL = 4.7, AHEAD = 20, POOL = AHEAD + 6, VX = 200, LANEPX = 122;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const mats = {}, mat = (col, rough = .7, metal = 0) => { const k = `${col},${rough},${metal}`; return mats[k] || (mats[k] = new T.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal })); };
  const geos = {}, G = (k, f) => geos[k] || (geos[k] = f());
  const M = c => typeof c === 'object' ? c : mat(c);
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); return o; };
  const box = (w, h, d, col, x, y, z) => mesh(G(`b${w},${h},${d}`, () => new T.BoxGeometry(w, h, d)), M(col), x, y, z);
  const cyl = (rt, rb, h, col, x, y, z, seg = 20) => mesh(G(`c${rt},${rb},${h},${seg}`, () => new T.CylinderGeometry(rt, rb, h, seg)), M(col), x, y, z);
  const sph = (r, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = mesh(G(`s${r}`, () => new T.SphereGeometry(r, 28, 20)), M(col), x, y, z); o.scale.set(sx, sy, sz); return o; };
  const cap = (r, len, col, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = mesh(G(`k${r},${len}`, () => new T.CapsuleGeometry(r, len, 8, 20)), M(col), x, y, z); o.scale.set(sx, sy, sz); return o; };
  const grp = (...kids) => { const g = new T.Group(); kids.forEach(k => k && g.add(k)); return g; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = T.SRGBColorSpace; return t; };
  const shadowsOn = o => o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  /* ---------- textures ---------- */
  const lockerTex = col => tex(512, 512, (g, w, h) => { // wall lockers: three doors with vents, handles and a little wear
    g.fillStyle = '#20356f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x = i * w / 3 + 8, ww = w / 3 - 16, gr = g.createLinearGradient(x, 0, x + ww, 0); gr.addColorStop(0, col); gr.addColorStop(.45, '#ffffff55'); gr.addColorStop(1, col);
      g.fillStyle = col; g.fillRect(x, 14, ww, h - 28); g.fillStyle = gr; g.globalAlpha = .35; g.fillRect(x, 14, ww, h - 28); g.globalAlpha = 1;
      g.fillStyle = '#0005'; for (let v = 0; v < 6; v++) g.fillRect(x + 24, 44 + v * 18, ww - 48, 8);
      g.fillStyle = '#ffffff33'; for (let v = 0; v < 6; v++) g.fillRect(x + 24, 52 + v * 18, ww - 48, 2);
      g.strokeStyle = '#00000044'; g.lineWidth = 3; g.strokeRect(x + 12, 160, ww - 24, h - 220);
      g.fillStyle = '#f2f6ff'; g.fillRect(x + ww - 34, h * .52, 12, 52); g.fillStyle = '#0003'; g.fillRect(x + ww - 22, h * .52, 3, 52);
      g.fillStyle = '#ffffffcc'; g.fillRect(x + 26, 124, 46, 20);
      for (let n = 0; n < 60; n++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${rnd() * .1})`; g.fillRect(x + rnd() * ww, 14 + rnd() * (h - 28), 2 + rnd() * 10, 1 + rnd()); }
    }
  });
  const labelTex = (text, bg, fg, w = 512, h = 160, size = 76, stripes) => tex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); if (stripes) { g.fillStyle = stripes; for (let x = -h; x < w; x += 44) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 22, h); g.lineTo(x + 48, h - 26); g.lineTo(x + 26, h - 26); g.fill(); } }
    g.fillStyle = fg; g.font = `900 ${size}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 - (stripes ? 8 : 0));
  });
  const tileTex = tex(1024, 356, (g, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() > .5 ? '255,255,255' : '0,0,0'},${rnd() * .05})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 14, 1 + rnd() * 2); } g.strokeStyle = 'rgba(20,30,70,.3)'; g.lineWidth = 4; for (let x = 0; x <= w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y <= h; y += h / 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } });
  const coinTex = tex(256, 256, (g) => { g.fillStyle = '#ffb81c'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill(); g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.fill(); g.strokeStyle = '#c47d00'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 92, 0, 7); g.stroke(); g.fillStyle = '#c47d00'; g.font = '900 128px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', 128, 136); });
  const blobTex = tex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, 'rgba(0,0,0,.45)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const blob = (s) => { const o = mesh(G('blob', () => new T.PlaneGeometry(1, 1)), blobMat); o.rotation.x = -Math.PI / 2; o.scale.set(s, s, 1); o.position.y = .03; return o; };

  /* ---------- built-in stand-ins (used until the GLB models load) ---------- */
  function mkLockerBank(col) { return grp(box(2.1, 3.1, 1.1, mat(col, .4, .4), 0, 1.7, 0), box(2.2, .15, 1.2, 0x0a1230, 0, .08, 0)); }
  function mkBags() { return grp(cap(.34, .42, mat(0xe03a5a, .9), -.5, .52, 0, 1.15, 1, .62), cap(.34, .42, mat(0x2f6bff, .9), .45, .52, 0, 1.15, 1, .62), cap(.3, .36, mat(0xf5a623, .9), 0, 1.15, 0, 1.15, 1, .62)); }
  const signMat = new T.MeshStandardMaterial({ map: labelTex('HALL CLOSED', '#e0233f', '#ffffff', 512, 160, 74, '#ffd24a'), roughness: .45, metalness: .1 });
  function mkSign() { // a hanging barrier: slide under it
    const red = mat(0x8a1224, .35, .5); return grp(mesh(G('signb', () => new T.BoxGeometry(2.2, 1.05, .16)), [red, red, mat(0xb91a33, .35, .5), red, signMat, signMat], 0, 2.2, 0), cyl(.04, .04, CEIL - 2.7, mat(0xc8d0e4, .3, .9), -.95, 2.7 + (CEIL - 2.7) / 2, 0, 10), cyl(.04, .04, CEIL - 2.7, mat(0xc8d0e4, .3, .9), .95, 2.7 + (CEIL - 2.7) / 2, 0, 10), box(2.3, .08, .2, mat(0xffd24a, .4, .3), 0, 1.68, 0));
  }
  function mkBeam() { // a steel beam across the hall, bolted into both walls: the HALL CLOSED sign hangs from it
    const steel = mat(0x8e9ab8, .32, .85), dark = mat(0x4a5578, .4, .7);
    return grp(box(WALL * 2 - .1, .24, .36, steel, 0, CEIL + .1, 0), box(WALL * 2 - .1, .05, .5, dark, 0, CEIL - .03, 0), box(WALL * 2 - .1, .05, .5, dark, 0, CEIL + .23, 0),
      box(.36, .9, .5, dark, -(WALL - .2), CEIL - .2, 0), box(.36, .9, .5, dark, WALL - .2, CEIL - .2, 0)); }
  const coinFace = new T.MeshStandardMaterial({ map: coinTex, emissive: 0x3a2200, roughness: .25, metalness: .7 }), coinMats = [mat(0xe29a00, .25, .9), coinFace, coinFace];
  function mkCoin() { const c = mesh(G('coin', () => new T.CylinderGeometry(.5, .5, .14, 40)), coinMats); c.rotation.x = Math.PI / 2; const g = grp(c); g.userData.spin = c; return g; }
  const glowTex = tex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  function mkMagnet() { // a classic horseshoe magnet: glossy red U, silver pole tips, a soft red glow and sparks circling it
    const red = new T.MeshPhysicalMaterial({ color: 0xe0142e, roughness: .22, metalness: .35, clearcoat: 1, clearcoatRoughness: .08 }), silver = new T.MeshStandardMaterial({ color: 0xf2f5fa, roughness: .12, metalness: 1 }), R0 = .34, t = .15;
    const arch = mesh(G('magArch', () => new T.TorusGeometry(R0, t, 24, 48, Math.PI)), red, 0, .12, 0);
    const legGeo = G('magLeg', () => new T.CylinderGeometry(t, t, .34, 24)), tipGeo = G('magTip', () => new T.CylinderGeometry(t * 1.03, t * 1.03, .2, 24));
    const g = grp(arch, mesh(legGeo, red, -R0, -.05, 0), mesh(legGeo, red, R0, -.05, 0), mesh(tipGeo, silver, -R0, -.32, 0), mesh(tipGeo, silver, R0, -.32, 0),
      mesh(G('magBand', () => new T.CylinderGeometry(t * 1.06, t * 1.06, .04, 24)), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .4 }), -R0, -.215, 0), mesh(G('magBand', () => null), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .4 }), R0, -.215, 0));
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xff3b52, transparent: true, opacity: .55, depthWrite: false, blending: T.AdditiveBlending })); glow.scale.set(1.9, 1.9, 1); g.add(glow);
    const sparks = new T.Group(); for (let i = 0; i < 5; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: i % 2 ? 0xffe27a : 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); sp.scale.setScalar(.18); sp.userData.a = i / 5 * Math.PI * 2; sparks.add(sp); } g.add(sparks); g.userData.sparks = sparks;
    g.scale.setScalar(1.25); g.rotation.z = -.18; return g; }
  function mkShield() { const s = mesh(G('shd', () => new T.SphereGeometry(.52, 32, 24)), new T.MeshStandardMaterial({ color: 0x4cc9ff, emissive: 0x0a4a66, roughness: .1, metalness: .3, transparent: true, opacity: .85 })); return grp(s, mesh(G('shr', () => new T.TorusGeometry(.6, .05, 12, 40)), mat(0xffffff, .3, .5))); }
  const TPL = { beam: mkBeam(), lockB: mkLockerBank(0x2f6bff), lockG: mkLockerBank(0x14c46f), bags: mkBags(), sign: mkSign(), coin: mkCoin(), magnet: mkMagnet(), shield: mkShield() };
  Object.values(TPL).forEach(shadowsOn);
  const clone = k => { const g = TPL[k].clone(); if (k === 'coin') g.userData.spin = g.children[0]; if (k === 'magnet') g.userData.sparks = g.children[g.children.length - 1]; return g; };

  /* ---------- GLB models ---------- */
  const fit = (obj, height, turn = 0) => { // scale a loaded model to a height, stand it on the floor, centre it in its lane
    const inner = new T.Group(); inner.add(obj); obj.rotation.y = turn; obj.updateMatrixWorld(true);
    const b = new T.Box3().setFromObject(obj), s = height / Math.max(.001, b.max.y - b.min.y); obj.scale.multiplyScalar(s); obj.updateMatrixWorld(true);
    b.setFromObject(obj); const c = b.getCenter(new T.Vector3()); obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y; shadowsOn(inner); return inner;
  };
  const tidy = root => root.traverse(m => { if (m.isMesh && m.material) [].concat(m.material).forEach(x => { if (x.map) x.map.anisotropy = 8; x.envMapIntensity = 1; }); });
  const hueTex = (t, deg) => { const im = t.image, c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.filter = `hue-rotate(${deg}deg) saturate(1.15)`; g.drawImage(im, 0, 0); const n = new T.CanvasTexture(c); n.flipY = t.flipY; n.colorSpace = t.colorSpace; n.anisotropy = 8; return n; };
  const loader = T.GLTFLoader ? new T.GLTFLoader() : null, load = url => new Promise(res => loader ? loader.load(url, res, undefined, () => res(null)) : res(null));

  /* ---------- the built-in mascot (stand-in): a Seahawk with wings and no backpack ---------- */
  function mkRunner() {
    const R = {}, root = new T.Group(), body = new T.Group(); root.add(body); R.root = root; R.body = body;
    const navy = mat(0x14245e, .75), blue = mat(0x1b4fd8, .75), white = mat(0xf4f7ff, .8), gold = mat(0xf5a623, .45, .1);
    body.add(cap(.4, .4, navy, 0, 1.42, 0, 1, 1, .78), cap(.3, .32, white, 0, 1.38, -.22, 1, 1, .4), sph(.42, navy, 0, 1.0, .02, 1, .62, .8));
    const head = new T.Group(); head.position.set(0, 2.2, 0); body.add(head); R.head = head;
    const beak = cyl(0, .13, .4, gold, 0, -.05, -.47, 16); beak.rotation.x = -Math.PI / 2;
    head.add(sph(.4, white, 0, 0, 0, 1, .95, 1), beak, box(.82, .1, .5, navy, 0, .08, -.02), sph(.06, 0x111111, -.18, .08, -.38), sph(.06, 0x111111, .18, .08, -.38));
    body.add(box(.5, .1, .55, navy, 0, .96, .45));
    const mkLeg = x => { const hip = new T.Group(); hip.position.set(x, 1.0, 0); const knee = new T.Group(); knee.position.set(0, -.55, 0); knee.add(cap(.1, .3, gold, 0, -.25, 0), box(.3, .08, .34, gold, 0, -.5, -.12)); hip.add(cap(.15, .3, navy, 0, -.27, 0), knee); hip.userData.knee = knee; body.add(hip); return hip; };
    const mkWing = x => { const sh = new T.Group(); sh.position.set(x * .45, 1.78, 0); const el = new T.Group(); el.position.set(x * .1, -.5, 0);
      sh.add(cap(.13, .4, blue, x * .08, -.25, 0)); for (let i = 0; i < 6; i++) { const f = box(.06, .7 - i * .06, .26, i % 2 ? navy : blue, x * (.03 + i * .07), -.32 + i * .02, .02 + i * .03); f.rotation.z = -x * (.05 + i * .06); el.add(f); }
      sh.add(el); sh.userData.el = el; body.add(sh); return sh; };
    R.legL = mkLeg(-.22); R.legR = mkLeg(.22); R.armL = mkWing(-1); R.armR = mkWing(1); shadowsOn(root);
    return R;
  }
  const HIP = 1.0;
  function pose(R, now, sp, air, slide, jk, land, lean, tum) {
    land = land || 0; lean = lean || 0; const p = now / 1000 * (7.5 + 3.4 * sp), body = R.body, airborne = air > 2, sl = slide || 0;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); R.head.rotation.set(0, 0, 0);
    let thL, thR, knL, knR, aw;
    if (airborne) { const flap = Math.sin(now / 70) * .25; thL = .95; knL = 1.25; thR = -.25; knR = .5; aw = 1.35 + flap; body.rotation.x = -.12; R.armL.rotation.x = R.armR.rotation.x = -.3; }
    else { const a = Math.sin(p), ca = Math.cos(p); thL = a * .95; thR = -a * .95; knL = .2 + Math.max(0, ca) * 1.15; knR = .2 + Math.max(0, -ca) * 1.15; aw = .35 + .15 * Math.abs(a); body.position.y = Math.abs(ca) * .16 - .06; body.rotation.x = -.16; body.rotation.y = a * .1; R.armL.rotation.x = -a * .8; R.armR.rotation.x = a * .8; }
    R.legL.rotation.x = thL; R.legR.rotation.x = thR; R.legL.userData.knee.rotation.x = -knL; R.legR.userData.knee.rotation.x = -knR; R.armL.rotation.z = -aw; R.armR.rotation.z = aw;
    if (sl > .02) { const th = -sl * 1.38, hipY = HIP + (.42 - HIP) * sl; body.rotation.x = th; body.position.y = hipY - HIP * Math.cos(th); body.position.z = -HIP * Math.sin(th); R.legL.rotation.x = thL * (1 - sl); R.legR.rotation.x = thR * (1 - sl); R.armL.rotation.x = R.armR.rotation.x = sl * .6; R.armL.rotation.z = -.2 - sl * .2; R.armR.rotation.z = .2 + sl * .2; R.head.rotation.x = sl * 1.05; }
    R.root.rotation.set(0, -lean * 1.1, -lean * .9);
    const sy = 1 - .2 * land, sxz = 1 + .1 * land; R.root.scale.set(sxz, sy, sxz); if (tum) { R.root.rotation.x = tum.rot; R.root.scale.multiplyScalar(tum.sc); }
  }

  /* ---------- the hallway ---------- */
  window.Dash3D = function (canvas, W, H) {
    let renderer; try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; }
    if (!renderer.getContext()) return null;
    let pr = 0; const sizeUp = () => { const n = clamp((window.devicePixelRatio || 1) * Math.max(1, canvas.clientWidth) / W, 1, 2.5); if (Math.abs(n - pr) > .05) { pr = n; renderer.setPixelRatio(pr); renderer.setSize(W, H, false); } }; sizeUp();
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25; renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const sky = new T.Color(0x3a56a8), scene = new T.Scene(); scene.background = sky; scene.fog = new T.Fog(sky, 30, ROW * AHEAD - 2);
    try { const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T.RoomEnvironment(renderer), .04).texture; } catch (e) {}
    scene.add(new T.HemisphereLight(0xdfe8ff, 0x34407a, 1.3));
    const sun = new T.DirectionalLight(0xfff6ea, 2.4); sun.position.set(5, 14, 7); sun.target.position.set(0, 0, -6); scene.add(sun, sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 18, bottom: -14, near: 1, far: 40 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .03; sun.shadow.camera.updateProjectionMatrix();
    const cam = new T.PerspectiveCamera(54, W / H, .3, 120), world = new T.Group(); scene.add(world);
    const LEN = ROW * (AHEAD + 8), midZ = -LEN / 2 + 8;
    for (const sd of [-1, 1]) {
      const wl = mesh(G(`uw`, () => new T.PlaneGeometry(LEN, CEIL - 3.3)), mat(0xa9bde6, .8), sd * WALL, 3.3 + (CEIL - 3.3) / 2, midZ); wl.rotation.y = -sd * Math.PI / 2; world.add(wl);
      world.add(mesh(G('stripe', () => new T.BoxGeometry(.12, .2, LEN)), new T.MeshBasicMaterial({ color: 0x3df0a0 }), sd * (WALL - .06), 3.38, midZ));
      world.add(mesh(G('glow', () => new T.BoxGeometry(.16, .12, LEN)), new T.MeshBasicMaterial({ color: 0xeaf2ff }), sd * (WALL - .08), CEIL, midZ)); // a light strip along the top of each wall
    }
    const lockerMats = ['#4a86ff', '#2fd68a'].map(c => new T.MeshStandardMaterial({ map: lockerTex(c), roughness: .38, metalness: .35 }));
    const floorMats = [0x5a73c4, 0x4c66b6].map(c => new T.MeshStandardMaterial({ color: c, map: tileTex, roughness: .22, metalness: .05 })), lineMat = new T.MeshBasicMaterial({ color: 0x8fb4ff });
    const tintMats = { 1: new T.MeshBasicMaterial({ color: 0xff3c50, transparent: true, opacity: .22, depthWrite: false }), 2: new T.MeshBasicMaterial({ color: 0xffc828, transparent: true, opacity: .26, depthWrite: false }), 3: new T.MeshBasicMaterial({ color: 0x3cc8ff, transparent: true, opacity: .26, depthWrite: false }) };
    const floorGeo = new T.PlaneGeometry(WALL * 2, ROW), laneGeo = new T.PlaneGeometry(LANE - .16, ROW * .98), lockGeo = new T.PlaneGeometry(ROW, 3.3), pool = [];
    for (let i = 0; i < POOL; i++) {
      const g = new T.Group(); world.add(g); const s = { g, r: -99, kids: [], floor: mesh(floorGeo, floorMats[0]), tints: [], lockL: mesh(lockGeo, lockerMats[0]), lockR: mesh(lockGeo, lockerMats[0]) };
      s.floor.rotation.x = -Math.PI / 2; s.floor.receiveShadow = true; g.add(s.floor);
      for (let l = 0; l < 3; l++) { const t = mesh(laneGeo, tintMats[1], (l - 1) * LANE, .02, 0); t.rotation.x = -Math.PI / 2; t.visible = false; g.add(t); s.tints.push(t); }
      for (const x of [-1.5, -.5, .5, 1.5]) g.add(mesh(G('ll', () => new T.BoxGeometry(.08, .02, ROW)), lineMat, x * LANE, .03, 0));
      s.lockL.position.set(-WALL + .01, 1.65, 0); s.lockL.rotation.y = Math.PI / 2; s.lockR.position.set(WALL - .01, 1.65, 0); s.lockR.rotation.y = -Math.PI / 2; s.lockL.receiveShadow = s.lockR.receiveShadow = true; g.add(s.lockL, s.lockR);
      g.add(box(.5, .35, ROW, mat(0x2a3a78, .5), -WALL + .25, .18, 0), box(.5, .35, ROW, mat(0x2a3a78, .5), WALL - .25, .18, 0)); pool.push(s);
    }
    const mkArch = text => grp(mesh(G('archb', () => new T.BoxGeometry(WALL * 2, 1.5, .3)), new T.MeshStandardMaterial({ map: labelTex(text, '#101c52', '#ffd24a', 768, 160, 68), roughness: .5 }), 0, 5.8, 0), box(.4, 6, .4, mat(0xffd24a, .35, .6), -WALL + .2, 3, 0), box(.4, 6, .4, mat(0xffd24a, .35, .6), WALL - .2, 3, 0));
    const arches = {}, archFor = r => arches[r] || (arches[r] = mkArch(['LEVEL 2 · SOPHOMORE', 'LEVEL 3 · JUNIOR', 'LEVEL 4 · SENIOR'][r / 100 - 1]));
    const vaultMat = new T.MeshStandardMaterial({ map: tex(512, 640, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff3b0'); gr.addColorStop(.6, '#ffc542'); gr.addColorStop(1, '#c78600'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(120,70,0,.25)'; g.fillRect(24, 24, w - 48, h - 48); g.fillStyle = '#6b3d00'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '200px system-ui'; g.fillText('🎓', w / 2, 200); g.font = '900 96px system-ui'; g.fillText('CLASS', w / 2, 380); g.font = '900 52px system-ui'; g.fillText('JACKPOT +500', w / 2, 480); }), emissive: 0x332000, roughness: .3, metalness: .5 });
    const vault = grp(box(WALL * 2, CEIL, .4, mat(0x2a3a78), 0, CEIL / 2, -.3), mesh(G('vd', () => new T.BoxGeometry(5.6, 6.2, .3)), vaultMat, 0, 3.1, 0)); vault.visible = false; world.add(vault);
    const foot = new T.Vector3(), out = { x: VX, y: 468 };

    function assign(s, r, rows) {
      s.r = r; s.kids.forEach(k => s.g.remove(k)); s.kids = []; const row = rows[r], par = ((r & 1) + 2) & 1;
      s.floor.material = floorMats[par]; s.lockL.material = s.lockR.material = lockerMats[((r % 2) + 2) % 2];
      for (let l = 0; l < 3; l++) { let kind = 0; for (let b = 1; b <= 3; b++) { const n = rows[r + b]; if (!n) continue; kind = (n[0] >> l & 1) ? 1 : (n[2] >> l & 1) ? 2 : (n[3] >> l & 1) ? 3 : kind; if (kind) break; } const t = s.tints[l]; t.visible = !!kind; if (kind) t.material = tintMats[kind]; }
      s.coin = s.power = null; s.beam = false;
      if (r === 100 || r === 200 || r === 300) { const a = archFor(r); a.position.z = 0; s.g.add(a); s.kids.push(a); }
      if (!row || r < 1) return;
      for (let l = 0; l < 3; l++) { const x = (l - 1) * LANE, z = .4 * ROW; let o = null;
        if (row[0] >> l & 1) o = clone((r + l) & 1 ? 'lockB' : 'lockG'); else if (row[2] >> l & 1) o = clone('bags'); else if (row[3] >> l & 1) o = clone('sign');
        if (o) { o.position.set(x, 0, z); s.g.add(o); s.kids.push(o); }
        if (o && row[3] >> l & 1 && !s.beam) { const bm = clone('beam'); bm.position.set(0, 0, z); s.g.add(bm); s.kids.push(bm); s.beam = true; }
        if (row[1] === l) { const c = clone('coin'); c.position.set(x, 1.3, z); s.g.add(c); s.kids.push(c); s.coin = c; }
        if (row[4] >= 0 && Math.floor(row[4] / 10) === l) { const p = clone(row[4] % 10 === 1 ? 'magnet' : 'shield'); p.position.set(x, 1.3, z); s.g.add(p); s.kids.push(p); s.power = p; } }
    }

    const R = mkRunner(); world.add(R.root);
    const rshadow = blob(1.8); world.add(rshadow);
    const shieldBall = mesh(G('shld', () => new T.SphereGeometry(1.45, 32, 24)), new T.MeshBasicMaterial({ color: 0x5bd0ff, transparent: true, opacity: .18, depthWrite: false })), mring = mesh(G('mrg', () => new T.TorusGeometry(1.7, .035, 8, 60)), new T.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: .55 }));
    mring.rotation.x = Math.PI / 2; world.add(shieldBall, mring);

    /* the Higgsfield Seahawk: skinned, with a run clip; jumps and slides are layered on top in code */
    let HAWK = null;
    const findBone = (root, re) => { let b = null; root.traverse(o => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };
    load('assets/dash-hawk.glb?v=1').then(g => { if (!g) return; tidy(g.scene);
      const pivot = new T.Group(), model = fit(g.scene, 2.55, Math.PI); const hipH = 1.15; model.position.y -= hipH; pivot.position.y = hipH; pivot.add(model);
      const mixer = new T.AnimationMixer(g.scene), clip = g.animations && g.animations[0], act = clip && mixer.clipAction(clip); if (act) act.play();
      const bones = { armL: findBone(g.scene, /^(mixamorig:?)?left_?arm$|leftarm$|upperarm_?l/i), armR: findBone(g.scene, /^(mixamorig:?)?right_?arm$|rightarm$|upperarm_?r/i), spine: findBone(g.scene, /spine$|spine1?$/i) };
      HAWK = { pivot, mixer, act, bones, last: 0 }; R.body.visible = false; R.root.add(pivot); window.__dashHawk = HAWK; });
    load('assets/dash-locker.glb?v=1').then(g => { if (!g) return; tidy(g.scene); const blue = fit(g.scene, 3.1, -Math.PI / 2); TPL.lockB = blue; TPL.lockG = blue.clone(); TPL.lockG.traverse(m => { if (m.isMesh && m.material && !Array.isArray(m.material)) { const y = m.material.clone(); if (y.map) y.map = hueTex(y.map, -88); m.material = y; } }); /* same locker, painted green */ pool.forEach(s => s.r = -99); });
    load('assets/dash-bags.glb?v=1').then(g => { if (!g) return; tidy(g.scene); TPL.bags = fit(g.scene, 1.55, -Math.PI / 2); pool.forEach(s => s.r = -99); });

    const q = new T.Quaternion(), e = new T.Euler();
    function hawkPose(now, sp, airborne, sl, jk, land, lean, tum) {
      const H = HAWK, dt = H.last ? Math.min(.05, (now - H.last) / 1000) : 0; H.last = now;
      if (H.act) H.act.timeScale = airborne ? .15 : sl > .3 ? .05 : .85 + .35 * sp; H.mixer.update(dt);
      const P = H.pivot; P.rotation.set(0, 0, 0); P.position.set(0, 1.15, 0);
      if (sl > .02) { P.rotation.x = -sl * 1.35; P.position.y = 1.15 + (.55 - 1.15) * sl; }
      else if (airborne) { P.rotation.x = -.15; }
      const wing = (b, s) => { if (!b) return; const k = airborne ? 1.1 + Math.sin(now / 70) * .25 : sl > .02 ? .5 * sl : 0; if (k) { e.set(0, 0, s * k); q.setFromEuler(e); b.quaternion.multiply(q); } };
      wing(H.bones.armL, 1); wing(H.bones.armR, -1);
      R.root.rotation.set(0, -lean * 1.1, -lean * .9); const sy = 1 - .2 * land, sxz = 1 + .1 * land; R.root.scale.set(sxz, sy, sxz); if (tum) { R.root.rotation.x = tum.rot; R.root.scale.multiplyScalar(tum.sc); }
    }

    function frame(run, rp, now, crashed, tum, sp) {
      sizeUp(); const base = Math.floor(rp) - 5, rows = run.rows;
      for (let r = base; r < base + POOL; r++) { const s = pool[((r % POOL) + POOL) % POOL]; if (s.r !== r || (r < rows.length && !s.hadRow && rows[r])) { assign(s, r, rows); s.hadRow = !!rows[r]; } s.g.position.z = -(r - rp + .5) * ROW;
        if (s.coin) { s.coin.visible = !run.got.has(r); s.coin.userData.spin.rotation.z = now / 260 + r; s.coin.position.y = 1.35 + Math.sin(now / 280 + r) * .12; }
        if (s.power) { s.power.visible = !run.got.has(-r); s.power.rotation.y = Math.sin(now / 500) * .7; s.power.position.y = 1.4 + Math.sin(now / 300) * .14; const sk = s.power.userData.sparks; if (sk) sk.children.forEach((p, i) => { const a = p.userData.a + now / 380; p.position.set(Math.cos(a) * .62, Math.sin(a * 1.3) * .35, Math.sin(a) * .62); p.material.opacity = .5 + .5 * Math.sin(now / 120 + i * 2); }); } }
      const toEnd = run.max + 1 - rp; vault.visible = toEnd < AHEAD + 3; vault.position.z = -toEnd * ROW;
      const wx = (run.laneX - VX) / LANEPX * LANE, lean = clamp((run.target - run.laneX) / 70, -1, 1), air = run.air / 78 * 1.8, airborne = run.air > 2;
      R.root.position.set(wx, air, 0);
      if (HAWK) hawkPose(now, sp, airborne, run.slide || 0, run.jk, run.land || 0, lean, tum); else pose(R, now, sp, run.air, run.slide, run.jk, run.land, lean, tum);
      const sh = 1 - Math.min(.5, air / 4.5); rshadow.position.set(wx, .04, 0); rshadow.scale.set(1.8 * sh, 1.8 * sh, 1);
      shieldBall.visible = !!run.shield; shieldBall.position.set(wx, 1.3 + air, 0); shieldBall.scale.setScalar(1 + Math.sin(now / 120) * .03);
      mring.visible = run.magnetUntil >= Math.floor(rp); mring.position.set(wx, 1.3 + air, 0); mring.rotation.z = now / 500;
      cam.position.set(0, 7.2, 9.6); cam.lookAt(0, .7, -3.5); // a fixed camera: it never slides, tilts, zooms or shakes
      renderer.render(scene, cam); cam.updateMatrixWorld(); foot.set(wx, .05, 0).project(cam); out.x = (foot.x * .5 + .5) * W; out.y = (-foot.y * .5 + .5) * H; return out;
    }
    return { frame, renderer, dispose() { renderer.dispose(); } };
  };
})();
