// ex/index.js: one entry point for the exercise screens (E6).
//   render(exercise, el, onAnswer, ctx) -> Promise<controller {showResult(result), destroy()}>
// `speak` (E9) and the letter types (E11) load their own modules when those exist.

import * as intro from './intro.js';
import * as match from './match.js';
import * as choice from './choice.js';
import * as bank from './bank.js';
import * as typein from './typein.js';
import * as listen from './listen.js';

const STATIC = {
  intro,
  match,
  choice_te_en: choice,
  choice_en_te: choice,
  listen_choice: listen,
  bank_te_en: bank,
  bank_en_te: bank,
  listen_bank: listen,
  typein,
  listen_type: listen,
};

const LATER = {
  speak: './speak.js',
  letter_intro: './letter.js',
  letter_sound: './letter.js',
  letter_name: './letter.js',
  letter_build: './letter.js',
};

export function moduleFor(type) {
  return STATIC[type] || null;
}

export async function render(exercise, el, onAnswer, ctx = {}) {
  let mod = STATIC[exercise.type];
  if (!mod && LATER[exercise.type]) mod = await import(LATER[exercise.type]);
  if (!mod) throw new Error(`ex: unknown exercise type ${exercise.type}`);
  return mod.render(exercise, el, onAnswer, ctx);
}
