import test from "node:test";
import assert from "node:assert/strict";
import { parseOfficialPolyline } from "../src/services/trafegusRoute.js";

test("parseia a polyline oficial do Elite", () => {
  assert.deepEqual(parseOfficialPolyline('[{"lat":-5,"lng":-49},{"lat":-6,"lng":-40}]'), [
    { latitude: -5, longitude: -49 },
    { latitude: -6, longitude: -40 },
  ]);
  assert.deepEqual(parseOfficialPolyline("inválida"), []);
});
