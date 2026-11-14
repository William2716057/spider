const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 18, 45);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0x8899cc, 0x221a14, 0.7));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.1);
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(80, 80, 0x2d3446, 0x232a39);
grid.position.y = 0.01;
scene.add(grid);

// ---- Spider body ----
const skin = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.45, metalness: 0.2 });
const legMat = new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.55 });
const spider = new THREE.Group();
scene.add(spider);

function mesh(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
    spider.add(m); return m;
}
const sph = new THREE.SphereGeometry(1, 32, 24);
mesh(sph, skin, 0, 0, 0.7, 0.55, 0.45, 0.7);          // cephalothorax
mesh(sph, skin, 0, 0.1, -0.9, 0.85, 0.75, 1.15);      // abdomen
const mark = new THREE.MeshStandardMaterial({ color: 0xb3171d, emissive: 0x330406, roughness: 0.4 });
mesh(sph, mark, 0, 0.62, -0.95, 0.22, 0.05, 0.4);     // red marking
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x1a5566, roughness: 0.1 });
[[-.14, .12], [.14, .12], [-.28, .02], [.28, .02], [-.08, .22], [.08, .22], [-.2, .2], [.2, .2]].forEach(([x, y], i) => {
    const s = i < 2 ? 0.1 : 0.06;
    mesh(sph, eyeMat, x, 0.12 + y * 0.5, 1.33 - Math.abs(x) * 0.3, s, s, s);
});
[-1, 1].forEach(s => mesh(sph, skin, s * 0.18, -0.12, 1.4, 0.07, 0.07, 0.3)); // fangs

// ---- Legs ----
const Y = new THREE.Vector3(0, 1, 0);
const L1 = 1.6, L2 = 2.3, HIP_H = 1.25;
const cylGeo = new THREE.CylinderGeometry(0.06, 0.1, 1, 8);
const jointGeo = new THREE.SphereGeometry(0.11, 12, 10);
const legs = [];
const zs = [0.75, 0.35, -0.05, -0.5];
const outAng = [0.55, 0.15, -0.2, -0.55];
for (let p = 0; p < 4; p++) for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.35, 0, zs[p] * 0.9);
    const dir = new THREE.Vector3(side * Math.cos(outAng[p]), 0, Math.sin(outAng[p])).normalize();
    const rest = hip.clone().setY(0).addScaledVector(dir, 2.7 - Math.abs(outAng[p]) * 0.3);
    const parts = [new THREE.Mesh(cylGeo, legMat), new THREE.Mesh(cylGeo, legMat),
    new THREE.Mesh(jointGeo, legMat), new THREE.Mesh(jointGeo, legMat)];
    parts.forEach(m => { m.castShadow = true; scene.add(m); });
    legs.push({
        hip, rest, parts, group: (p + (side > 0 ? 0 : 1)) % 2,
        foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: -1
    });
}

function place(m, a, b) {
    const d = b.clone().sub(a), len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
}

function solveLeg(leg) {
    const H = spider.localToWorld(leg.hip.clone().setY(0)).setY(spider.position.y + 0.05 + HIP_H - 1.25 + 0.0);
    H.y = spider.position.y;
    const F = leg.foot;
    const v = F.clone().sub(H);
    const d = Math.min(v.length(), (L1 + L2) * 0.995);
    const dir = v.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
    const up = Y.clone().addScaledVector(dir, -Y.dot(dir)).normalize();
    const knee = H.clone().addScaledVector(dir, a).addScaledVector(up, h);
    const foot = H.clone().addScaledVector(dir, d);
    place(leg.parts[0], H, knee);
    place(leg.parts[1], knee, foot);
    leg.parts[2].position.copy(knee);
    leg.parts[3].position.copy(foot);
}

// ---- Movement ----
let heading = 0, target = new THREE.Vector3(6, 0, 6), userTarget = false;
const vel = new THREE.Vector3();
spider.position.set(0, HIP_H, 0);
spider.updateMatrixWorld(true);
legs.forEach(l => { l.foot.copy(spider.localToWorld(l.rest.clone())).setY(0); });

function pickWander() {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
    target.set(Math.cos(a) * r, 0, Math.sin(a) * r); userTarget = false;
}

const clock = new THREE.Clock();
let bob = 0;
function update(dt) {
    const to = target.clone().sub(spider.position).setY(0);
    const dist = to.length();
    if (dist < 0.8) pickWander();
    else {
        const want = Math.atan2(to.x, to.z);
        let diff = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
        heading += diff * Math.min(1, dt * 3);
        const speed = Math.abs(diff) > 1.2 ? 0.4 : 3.2;
        vel.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed);
        spider.position.addScaledVector(vel, dt);
    }
    spider.rotation.y = heading;
    const moving = vel.length() > 0.5;
    bob += dt * (moving ? 9 : 1.5);
    spider.position.y = HIP_H + Math.sin(bob) * (moving ? 0.04 : 0.02);
    spider.updateMatrixWorld(true);

    // stepping
    const stepping = [false, false];
    legs.forEach(l => { if (l.t >= 0) stepping[l.group] = true; });
    legs.forEach(l => {
        if (l.t >= 0) {
            l.t += dt / 0.2;
            if (l.t >= 1) { l.t = -1; l.foot.copy(l.to); }
            else {
                l.foot.lerpVectors(l.from, l.to, l.t);
                l.foot.y = Math.sin(l.t * Math.PI) * 0.8;
            }
        } else if (!stepping[1 - l.group]) {
            const rw = spider.localToWorld(l.rest.clone()).setY(0);
            if (rw.distanceTo(l.foot) > 1.1) {
                l.from.copy(l.foot);
                l.to.copy(rw).addScaledVector(vel, 0.18);
                l.t = 0; stepping[l.group] = true;
            }
        }
        solveLeg(l);
    });
}

// ---- Camera orbit ----
let theta = 0.8, phi = 1.0, radius = 13;
const camTarget = new THREE.Vector3();
function updateCamera() {
    camTarget.lerp(spider.position, 0.08);
    camera.position.set(
        camTarget.x + radius * Math.sin(phi) * Math.sin(theta),
        camTarget.y + radius * Math.cos(phi),
        camTarget.z + radius * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(camTarget);
}

const el = renderer.domElement;
let drag = null, moved = 0;
el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; moved = 0; el.setPointerCapture(e.pointerId); });
el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    theta -= dx * 0.006;
    phi = Math.min(1.45, Math.max(0.2, phi - dy * 0.006));
    drag = { x: e.clientX, y: e.clientY };
});
el.addEventListener('pointerup', e => {
    drag = null;
    if (moved < 6) {
        const r = el.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
        const hit = rc.intersectObject(ground)[0];
        if (hit) { target.copy(hit.point); userTarget = true; }
    }
});
el.addEventListener('wheel', e => { e.preventDefault(); radius = Math.min(30, Math.max(5, radius + e.deltaY * 0.01)); }, { passive: false });

function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

renderer.setAnimationLoop(() => {
    update(Math.min(clock.getDelta(), 0.05));
    sun.position.set(spider.position.x + 6, 12, spider.position.z + 4);
    sun.target.position.copy(spider.position); sun.target.updateMatrixWorld();
    updateCamera();
    renderer.render(scene, camera);
});