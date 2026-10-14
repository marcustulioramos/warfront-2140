/* global console */
import { performance } from "node:perf_hooks";
import {
  sectorRoute,
  startingSectors,
  WORLD_HALF_SIZE,
  SECTOR_SIZE,
} from "../packages/shared/dist/index.js";

const sectors = startingSectors();
const start = performance.now();
let traversed = 0;
for (let index = 0; index < 100_000; index++) {
  const a = sectors[index % sectors.length];
  const b = sectors[(index * 7 + 5) % sectors.length];
  const point = (sector) => ({
    x: -WORLD_HALF_SIZE + (sector.column + 0.5) * SECTOR_SIZE,
    z: -WORLD_HALF_SIZE + (sector.row + 0.5) * SECTOR_SIZE,
  });
  traversed += sectorRoute(point(a), point(b)).length;
}
const elapsed = performance.now() - start;
console.log(
  `100,000 sector routes in ${elapsed.toFixed(1)} ms; ${Math.round(100_000 / (elapsed / 1000)).toLocaleString()} routes/s; ${traversed} sectors traversed`,
);
