// ex/listen.js: the listening types (S4): listen_choice, listen_bank, listen_type. Each is the
// matching choice / bank / typing screen with the audio prompt in place of the text.

import * as choice from './choice.js';
import * as bank from './bank.js';
import * as typein from './typein.js';

const BY = { listen_choice: choice, listen_bank: bank, listen_type: typein };

export function render(exercise, el, onAnswer, ctx = {}) {
  const mod = BY[exercise.type];
  if (!mod) throw new Error(`listen: not a listening exercise: ${exercise.type}`);
  return mod.render(exercise, el, onAnswer, ctx);
}
