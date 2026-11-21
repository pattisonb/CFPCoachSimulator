// usage: node px.mjs specs.json out.bin  -> 48*48*4 bytes per face; prints validation problems
import { createFaces } from "/home/user/CFPCoachSimulator/pocket-faces/src/index.ts";
import { readFileSync, writeFileSync } from "fs";
const faces = createFaces(JSON.parse(readFileSync("/home/user/CFPCoachSimulator/pocket-faces/faces.json", "utf8")));
const specs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
specs.forEach((s, i) => { const bad = faces.validate(s); if (bad.length) console.log(i, bad); out.push(Buffer.from(faces.pixels(faces.resolve(s)))); });
writeFileSync(process.argv[3], Buffer.concat(out));
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(specs.map((s) => faces.resolve(s))));
