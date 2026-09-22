import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmbarquesPeriodos } from '../src/services/embarquesClientesService.js';
const ends=(startDate,endDate)=>resolveEmbarquesPeriodos({startDate,endDate}).periodos.map(p=>p.endDate);
test('setembro completo inclui dia 31 de agosto e julho',()=>assert.deepEqual(ends('2026-09-01','2026-09-30'),['2026-09-30','2026-08-31','2026-07-31']));
test('intervalo parcial preserva os mesmos dias',()=>assert.deepEqual(ends('2026-09-01','2026-09-10'),['2026-09-10','2026-08-10','2026-07-10']));
test('fevereiro completo e virada do ano',()=>assert.deepEqual(ends('2024-02-01','2024-02-29'),['2024-02-29','2024-01-31','2023-12-31']));
test('dia 30 parcial de agosto não vira mês cheio',()=>assert.deepEqual(ends('2026-08-01','2026-08-30'),['2026-08-30','2026-07-30','2026-06-30']));
