import { ANSWER_WORDS, VALID_GUESSES } from './words.js';

export function selectSecretWord() {
  return ANSWER_WORDS[Math.floor(Math.random() * ANSWER_WORDS.length)];
}

export function isValidGuess(word) {
  return VALID_GUESSES.has(word.toLowerCase());
}

// Two-pass algorithm — handles duplicate letters correctly.
// Pass 1: mark exact matches and consume those secret positions.
// Pass 2: mark present letters against remaining (unconsumed) secret positions.
export function evaluateGuess(guess, secret) {
  guess = guess.toLowerCase();
  secret = secret.toLowerCase();

  const result = Array(5).fill('absent');
  const secretRemaining = secret.split('');

  for (let i = 0; i < 5; i++) {
    if (guess[i] === secret[i]) {
      result[i] = 'correct';
      secretRemaining[i] = null;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    const idx = secretRemaining.indexOf(guess[i]);
    if (idx !== -1) {
      result[i] = 'present';
      secretRemaining[idx] = null;
    }
  }

  return result;
}

// Returns a map of letter → best status across all guesses.
// Priority: correct > present > absent.
export function buildKeyboardState(guesses) {
  const PRIORITY = { correct: 3, present: 2, absent: 1 };
  const state = {};

  for (const { word, result } of guesses) {
    for (let i = 0; i < 5; i++) {
      const letter = word[i];
      const status = result[i];
      if (!state[letter] || PRIORITY[status] > PRIORITY[state[letter]]) {
        state[letter] = status;
      }
    }
  }

  return state;
}
