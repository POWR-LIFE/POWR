#!/usr/bin/env node
/**
 * Check a blueprint template before it's published (the weekly Studio trend
 * routine runs this; so can you):
 *   node scripts/blueprint-check.mjs path/to/blueprint.json
 * Prints the problems and exits 1, or writes the cleaned blueprint next to
 * the input as <name>.clean.json and exits 0. Publish the CLEAN file. The
 * rules live in src/studio/blueprint/schema.js — the Studio runs the same
 * check when it loads a blueprint, and skips any that fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkBlueprint } from '../src/studio/blueprint/schema.js';

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/blueprint-check.mjs blueprint.json');
    process.exit(2);
}
let input;
try {
    input = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
    console.error(`Not valid JSON: ${e.message}`);
    process.exit(1);
}
const { ok, errors, blueprint } = checkBlueprint(input);
if (!ok) {
    console.error(`✗ ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}
const out = path.join(path.dirname(file), `${path.basename(file, '.json')}.clean.json`);
fs.writeFileSync(out, JSON.stringify(blueprint, null, 2));
const shapes = Object.keys(blueprint.layouts).join(', ');
console.log(`✓ ${blueprint.id} "${blueprint.name}" — layouts: ${shapes}; ${blueprint.fields.length} fields, ${blueprint.presets.length} presets${blueprint.swatches.length ? `, ${blueprint.swatches.length} colours` : ''}`);
console.log(`  clean copy: ${out}`);
