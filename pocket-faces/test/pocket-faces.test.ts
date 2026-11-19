/**
 * The package's own checks (`npm test` here). The compositor itself is checked against the golden faces by
 * lib/facekit/facekit.test.ts at the repo root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFaces, composite, faceFields, seedOf, randomFace, resolveFace, VERSION, type Manifest } from "../src/index.ts";
import data from "../src/data.ts";

const faces = createFaces(data);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the data module, faces.json and the version agree", () => {
  const json = JSON.parse(readFileSync(new URL("../faces.json", import.meta.url), "utf8"));
  assert.deepEqual(json, data);
  assert.equal(data.version, pkg.version);
  assert.equal(VERSION, pkg.version);
});

test("the packaged data draws the same faces as the art it came from", () => {
  const art = JSON.parse(readFileSync(new URL("../../../art/manifest.json", import.meta.url), "utf8")) as Manifest;
  for (let i = 0; i < 50; i++) {
    const spec = randomFace(art, seedOf(`p${i}`));
    assert.deepEqual(randomFace(data, seedOf(`p${i}`)), spec, "out of date: run npm run build");
    assert.deepEqual(composite(data, spec), composite(art, spec), "out of date: run npm run build");
  }
});

test("random(id) is stable, complete, and round-trips through JSON", () => {
  const a = faces.random("player-7");
  assert.deepEqual(faces.random("player-7"), a);
  assert.deepEqual(faces.random(seedOf("player-7")), a);
  assert.deepEqual(Object.keys(a), faceFields(data));
  assert.deepEqual(Object.keys(a), ["faceShape", "skinTone", "hairColor", "eyeColor", "ears", "chin", "nose", "beard", "mouth", "brows", "hair", "hairFade", "flip"]);
  assert.deepEqual(faces.parse(JSON.stringify(a)), a);
  assert.deepEqual(faces.pixels(a), composite(data, a));
});

test("every option and every catalog choice is a face the kit can draw", () => {
  const { flip, ...rest } = faces.options();
  const base = faces.random("x");
  for (const c of flip) assert.equal(faces.pixels({ ...base, flip: [c] }).length, 48 * 48 * 4, `flip ${c}`);
  for (const [field, list] of Object.entries(rest)) {
    for (const v of list) assert.equal(faces.pixels({ ...base, [field]: v }).length, 48 * 48 * 4, `${field} ${v}`);
  }
  const cat = faces.catalog();
  assert.deepEqual(cat.map((e) => e.field), ["faceShape", "skinTone", "ears", "chin", "nose", "beard", "mouth", "brows", "hair", "hairColor", "eyeColor"]);
  for (const e of cat) {
    assert.ok(e.choices.length > 0, e.field);
    for (const ch of e.choices) {
      assert.ok(ch.label, `${e.field} ${ch.id} has a name`);
      faces.parse({ ...base, [e.field]: ch.id });
    }
  }
  assert.equal(cat.find((e) => e.field === "hair")!.choices[0].id, null);
  assert.equal(cat.find((e) => e.field === "hair")!.choices.find((c) => c.id === "hair_25")!.label, "Quiff");
});

test("random faces skip parts marked not random", () => {
  const off = new Set(data.order.flatMap((c) => data.parts[c].filter((p) => p.random === false).map((p) => `${c}/${p.id}`)));
  assert.ok(off.has("mouth/mouth_04"));
  for (let i = 0; i < 2000; i++) {
    const f = faces.random(`r${i}`);
    for (const c of data.order) assert.ok(!off.has(`${c}/${f[data.categories[c].field]}`), `r${i} ${c}`);
  }
  assert.equal(faces.parse({ ...faces.random("x"), mouth: "mouth_04" }).mouth, "mouth_04");
});

test("fade and flip: only where the part has one, and the JSON says so", () => {
  const base = faces.random("x");
  const faded = { ...base, hair: "hair_25", hairFade: true };
  assert.ok(faces.canFade(faded));
  assert.equal(faces.resolve(faded).hairFade, true);
  assert.notDeepEqual(faces.pixels(faded), faces.pixels({ ...faded, hairFade: false }));
  assert.equal(faces.canFade({ ...base, hair: "hair_19" }), false);
  assert.equal(faces.resolve({ ...base, hair: "hair_19", hairFade: true }).hairFade, false);
  const smirk = { ...base, mouth: "mouth_03", flip: ["mouth"] };
  assert.ok(faces.canFlip(smirk, "mouth"));
  assert.deepEqual(faces.resolve(smirk).flip, ["mouth"]);
  assert.notDeepEqual(faces.pixels(smirk), faces.pixels({ ...smirk, flip: [] }));
  assert.equal(faces.canFlip({ ...base, mouth: "mouth_00" }, "mouth"), false);
  assert.deepEqual(faces.resolve({ ...base, mouth: "mouth_00", flip: ["mouth"] }).flip, []);
});

test("a v0.1 face loads: the new fields take their defaults", () => {
  const v01 = { faceShape: "face_shape_04", skinTone: "brown", hair: "hair_01", hairColor: "darkbrown", beard: "beard_02", nose: "nose_03", mouth: "mouth_03", ears: "ears_00", chin: null, eyeColor: "brown" };
  const f = faces.parse(v01);
  assert.equal(f.brows, "brows_00");
  assert.equal(f.hairFade, false);
  assert.deepEqual(f.flip, []);
  for (const [k, v] of Object.entries(v01)) assert.equal(f[k], v, k);
});

test("a minimal face fills in the defaults; bad ids are listed", () => {
  const min = { faceShape: "face_shape_00", skinTone: "light", hairColor: "black" };
  const f = faces.parse(min);
  assert.deepEqual(f, resolveFace(data, min));
  assert.equal(f.nose, "nose_00");
  assert.equal(f.hair, null);
  assert.equal(f.beard, null);
  assert.deepEqual(faces.validate(f), []);
  const errors = faces.validate({ ...f, hair: "hair_99", skinTone: "green" });
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /hair_99/);
  assert.throws(() => faces.parse({ skinTone: "light" }), /faceShape is required/);
});

test("repair: a removed id takes the first option, and says so", () => {
  const old = { ...faces.random("x"), hairColor: "gray", beard: "beard_06", hairFade: "yes" };
  assert.throws(() => faces.parse(old));
  const { face, fixed } = faces.repair(old);
  assert.equal(face.hairColor, data.hairColors[0].id);
  assert.equal(face.beard, null);
  assert.equal(face.hairFade, false);
  assert.equal(fixed.length, 3);
  assert.deepEqual(faces.parse(face), face);
  assert.deepEqual(faces.repair(face).fixed, []);
});

test("drawing without a DOM says so", () => {
  assert.throws(() => faces.canvas(faces.random("x")), /browser/);
});
