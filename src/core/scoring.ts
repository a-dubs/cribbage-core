import { Card, ScoreBreakdownItem, ScoreBreakdownType } from '../types'; // Assuming this is the file where the Card type is defined.
import { getBreakdownDescription } from './scoringBreakdown';

type CardValue = {
  pegValue: number;
  runValue: number;
  suit: string;
};

const parseCardValues = (
  card: Card
): { pegValue: number; runValue: number } => {
  const rank = card.split('_')[0];
  if (rank === 'ACE') return { pegValue: 1, runValue: 1 };
  if (rank === 'JACK') return { pegValue: 10, runValue: 11 };
  if (rank === 'QUEEN') return { pegValue: 10, runValue: 12 };
  if (rank === 'KING') return { pegValue: 10, runValue: 13 };
  // otherwise parse ONE through TEN as a number
  if (rank === 'TEN') return { pegValue: 10, runValue: 10 };
  if (rank === 'NINE') return { pegValue: 9, runValue: 9 };
  if (rank === 'EIGHT') return { pegValue: 8, runValue: 8 };
  if (rank === 'SEVEN') return { pegValue: 7, runValue: 7 };
  if (rank === 'SIX') return { pegValue: 6, runValue: 6 };
  if (rank === 'FIVE') return { pegValue: 5, runValue: 5 };
  if (rank === 'FOUR') return { pegValue: 4, runValue: 4 };
  if (rank === 'THREE') return { pegValue: 3, runValue: 3 };
  if (rank === 'TWO') return { pegValue: 2, runValue: 2 };
  throw new Error(`Invalid card rank: ${rank}`);
};

export const parseCard = (card: Card): CardValue => {
  const { pegValue, runValue } = parseCardValues(card);
  const suit = card.split('_')[1];
  if (!suit) {
    throw new Error(`Invalid card format: ${card}`);
  }
  return {
    pegValue,
    runValue,
    suit,
  };
};

const sortCards = (hand: Card[], cutCard: Card): CardValue[] => {
  return [...hand.map(parseCard), parseCard(cutCard)].sort(
    (a, b) => a.runValue - b.runValue
  );
};

const rightJack = (hand: Card[], cutCard: Card): number => {
  const cutSuit = parseCard(cutCard).suit;
  return hand.some(
    card => card.startsWith('JACK') && parseCard(card).suit === cutSuit
  )
    ? 1
    : 0;
};

const flush = (hand: Card[], cutCard: Card, isCrib: boolean): number => {
  const suits = hand.map(card => parseCard(card).suit);
  const allSameSuit = suits.every(suit => suit === suits[0]);
  const cutSuit = parseCard(cutCard).suit;

  if (allSameSuit) {
    return suits[0] === cutSuit ? 5 : isCrib ? 0 : 4;
  }
  return 0;
};

const countFifteens = (cards: CardValue[]): number => {
  let totalPoints = 0;

  // Loop through combination sizes from 2 to 5
  for (let size = 2; size <= cards.length; size++) {
    const indices = [...Array(cards.length).keys()];
    const combinations = getCombinations(indices, size);

    // Check if the sum of any combination equals 15
    for (const combination of combinations) {
      const sum = combination.reduce((acc, index) => {
        const card = cards[index];
        if (!card) return acc;
        return acc + card.pegValue;
      }, 0);
      if (sum === 15) {
        totalPoints += 2;
      }
    }
  }

  return totalPoints;
};

const getCombinations = (arr: number[], size: number): number[][] => {
  if (size === 0) return [[]];
  if (arr.length < size) return [];
  const [first, ...rest] = arr;
  if (first === undefined) return [];
  const withFirst = getCombinations(rest, size - 1).map(combo => [
    first,
    ...combo,
  ]);
  const withoutFirst = getCombinations(rest, size);
  return [...withFirst, ...withoutFirst];
};

function longestConsecutiveRun(cardFreq: { [key: number]: number }): number[] {
  const keys = Object.keys(cardFreq)
    .map(Number) // Convert keys to numbers
    .sort((a, b) => a - b); // Sort keys in ascending order

  let longestRun: number[] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < keys.length; i++) {
    const currentKey = keys[i];
    const prevKey = i > 0 ? keys[i - 1] : undefined;
    if (currentKey === undefined) continue;
    if (i === 0 || (prevKey !== undefined && currentKey === prevKey + 1)) {
      // If the current key is consecutive, add it to the current run
      currentRun.push(currentKey);
    } else {
      // Otherwise, compare and reset the current run
      if (currentRun.length > longestRun.length) {
        longestRun = currentRun;
      }
      currentRun = [currentKey];
    }
  }

  // Check the final run
  if (currentRun.length > longestRun.length) {
    longestRun = currentRun;
  }

  return longestRun;
}

export const score_runs = (cards: CardValue[]): number => {
  let score = 0;

  // create dict of frequency of each run value
  const cardFreq: { [key: number]: number } = {};
  cards.forEach(card => {
    cardFreq[card.runValue] = (cardFreq[card.runValue] || 0) + 1;
  });

  // use card frequency to calculate run length and then multiply by the frequency of each card above 1, accumulating
  // using multiplication
  // iterate through the cardFreq object and calculate the run length
  const longestRun = longestConsecutiveRun(cardFreq);

  if (longestRun.length < 3) {
    return 0;
  }

  const mult = longestRun.reduce((acc, card) => acc * (cardFreq[card] || 1), 1);
  score += longestRun.length * mult;

  return score;
};

const pairs = (cards: CardValue[]): number => {
  let score = 0;
  for (let i = 0; i < cards.length - 1; i++) {
    const cardI = cards[i];
    if (!cardI) continue;
    for (let j = i + 1; j < cards.length; j++) {
      const cardJ = cards[j];
      if (!cardJ) continue;
      if (cardI.runValue === cardJ.runValue) {
        score += 2;
      }
    }
  }
  return score;
};

export const suitToEmoji = (suit: string): string => {
  switch (suit) {
    case 'HEARTS':
      return '♥️';
    case 'DIAMONDS':
      return '♦️';
    case 'CLUBS':
      return '♣️';
    case 'SPADES':
      return '♠️';
    default:
      return '';
  }
};

export const displayCard = (card: Card): string => {
  const { runValue, suit } = parseCard(card);
  const rankParts = card.split('_');
  const rank = runValue <= 10 ? runValue.toString() : rankParts[0]?.[0] ?? '';
  return `${rank}${suitToEmoji(suit)}`;
};

export const scoreHand = (
  hand: Card[],
  cutCard: Card,
  isCrib: boolean
): number => {
  if (hand.length !== 4) {
    throw new Error('Hand must contain exactly 4 cards.');
  }

  const sortedCards = sortCards(hand, cutCard);

  const rightJackScore = rightJack(hand, cutCard);
  const flushScore = flush(hand, cutCard, isCrib);
  const fifteensScore = countFifteens(sortedCards);
  const runsScore = score_runs(sortedCards);
  const pairsScore = pairs(sortedCards);

  const totalScore =
    rightJackScore + flushScore + fifteensScore + runsScore + pairsScore;

  // let debug_str = '';

  // debug_str += `Cards:\n${sortedCards
  //   .map(card => `${card.runValue}${suitToEmoji(card.suit)}`)
  //   .join(', ')}\n`;
  // debug_str += `Total: ${totalScore}\n`;

  // console.debug(debug_str);

  return totalScore;
};

const scorePegging15 = (peggingStack: CardValue[]): number => {
  const sum_of_stack = peggingStack.reduce(
    (acc, card) => acc + card.pegValue,
    0
  );
  return sum_of_stack === 15 ? 2 : 0;
};

const scorePegging31 = (peggingStack: CardValue[]): number => {
  const sum_of_stack = peggingStack.reduce(
    (acc, card) => acc + card.pegValue,
    0
  );
  return sum_of_stack === 31 ? 2 : 0;
};

export const sumOfPeggingStack = (peggingStack: Card[]): number => {
  return peggingStack.reduce((acc, card) => acc + parseCard(card).pegValue, 0);
};

const scorePeggingSameRank = (peggingStack: CardValue[]): number => {
  // start at the most recent card played (last card in the stack) and iterate backwards
  // count how many cards in a row have the same rank
  // stop when a card with a different rank is found

  let score = 0;
  let i = peggingStack.length - 1;
  while (i > 0) {
    const current = peggingStack[i];
    const prev = peggingStack[i - 1];
    if (!current || !prev) break;
    if (current.runValue === prev.runValue) {
      i--;
    } else {
      break;
    }
  }

  const run_length = peggingStack.length - i;
  if (run_length === 2) {
    score = 2;
  } else if (run_length === 3) {
    score = 6;
  } else if (run_length === 4) {
    score = 12;
  }

  return score;
};

const allCardsAreConsecutive = (cards: CardValue[]): boolean => {
  for (let i = 0; i < cards.length - 1; i++) {
    const current = cards[i];
    const next = cards[i + 1];
    if (!current || !next) return false;
    if (current.runValue + 1 !== next.runValue) {
      return false;
    }
  }
  return true;
};

const scorePeggingRun = (peggingStack: CardValue[]): number => {
  // the entire stack must be checked in order to be certain if there is no run
  // the run does NOT have to be in order
  // take slices of the stack starting at the most recent card and iterate backwards
  // for each slice, if after sorting the slice, there are NO duplicates and the slice forms a continuous run, then save
  // the length of this run
  // return the length of the longest run found

  let longest_run = 0;

  for (let i = peggingStack.length - 1; i >= 0; i--) {
    const slice = peggingStack.slice(i);
    const sorted_slice = slice.sort((a, b) => a.runValue - b.runValue);
    // if there are any duplicates, then this slice cannot be a run
    const has_duplicates = sorted_slice.some((card, index) => {
      const next = sorted_slice[index + 1];
      return next !== undefined && card.runValue === next.runValue;
    });
    if (has_duplicates) {
      continue;
    }
    if (allCardsAreConsecutive(sorted_slice)) {
      const run_length = sorted_slice.length;
      if (run_length > longest_run) {
        longest_run = run_length;
      }
    }
  }

  return longest_run > 2 ? longest_run : 0;
};

export const scorePegging = (peggingStack: Card[]): number => {
  const parsedStack = peggingStack.map(parseCard);
  let score = 0;
  // if the sum of the stack is 15, score 2 points
  score += scorePegging15(parsedStack);
  // if the sum of the stack is 31, score 2 points
  score += scorePegging31(parsedStack);
  // if the last X cards are the same rank (pegValue), score either 2, 6, or 12 points
  score += scorePeggingSameRank(parsedStack);
  // if the last X cards form a run, score the length of the run
  score += scorePeggingRun(parsedStack);

  return score;
};

/**
 * Helper to create a breakdown item
 */
function createBreakdownItem(
  type: ScoreBreakdownType,
  points: number,
  cards: Card[]
): ScoreBreakdownItem {
  return {
    type,
    points,
    cards,
    description: getBreakdownDescription(type),
  };
}

/**
 * Score hand with detailed breakdown
 * Returns both total score and itemized breakdown
 *
 * Detection priority (to prevent duplication):
 * 1. Complex runs (double/triple/quadruple) - highest priority
 * 2. Simple runs (only if cards not in complex run)
 * 3. Pairs/Three of a kind/Four of a kind (only if cards not in runs)
 * 4. Fifteens (all combinations, independent)
 * 5. Flush (independent)
 * 6. Right Jack (independent)
 */
export const scoreHandWithBreakdown = (
  hand: Card[],
  cutCard: Card,
  isCrib: boolean
): { total: number; breakdown: ScoreBreakdownItem[] } => {
  if (hand.length !== 4) {
    throw new Error('Hand must contain exactly 4 cards.');
  }

  const breakdown: ScoreBreakdownItem[] = [];
  const allCards: Card[] = [...hand, cutCard];
  const sortedCardValues = sortCards(hand, cutCard);

  // Map to track which cards are used by complex runs
  // We'll use indices into sortedCardValues array
  const usedIndices = new Set<number>();

  // Helper to convert CardValue indices back to Card[]
  const getCardsFromIndices = (indices: number[]): Card[] => {
    return indices.map(idx => {
      const cardValue = sortedCardValues[idx];
      if (!cardValue) {
        throw new Error(`CardValue not found at index ${idx}`);
      }
      // Find the original card by matching runValue and suit
      const found = allCards.find(card => {
        const parsed = parseCard(card);
        return (
          parsed.runValue === cardValue.runValue &&
          parsed.suit === cardValue.suit
        );
      });
      if (!found) {
        throw new Error(
          `Card not found for runValue ${cardValue.runValue}, suit ${cardValue.suit}`
        );
      }
      return found;
    });
  };

  // 1. DETECT COMPLEX RUNS (highest priority)
  // Check for quadruple run of 3 (e.g., [2, 3, 3, 4, 4])
  // Check for triple run of 3 (e.g., [2, 3, 4, 4, 4])
  // Check for double run of 4 (e.g., [2, 3, 4, 5, 5])
  // Check for double run of 3 (e.g., [2, 3, 4, 4])

  // Create frequency map
  const cardFreq: { [key: number]: number[] } = {}; // runValue -> array of indices
  sortedCardValues.forEach((card, idx) => {
    if (!card) return;
    if (!cardFreq[card.runValue]) {
      cardFreq[card.runValue] = [];
    }
    cardFreq[card.runValue]!.push(idx);
  });

  // Find longest consecutive run
  const runValues = Object.keys(cardFreq)
    .map(Number)
    .sort((a, b) => a - b);
  let longestRun: number[] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < runValues.length; i++) {
    const currentValue = runValues[i];
    const prevValue = i > 0 ? runValues[i - 1] : undefined;
    if (currentValue === undefined) continue;
    if (
      i === 0 ||
      (prevValue !== undefined && currentValue === prevValue + 1)
    ) {
      currentRun.push(currentValue);
    } else {
      if (currentRun.length > longestRun.length) {
        longestRun = currentRun;
      }
      currentRun = [currentValue];
    }
  }
  if (currentRun.length > longestRun.length) {
    longestRun = currentRun;
  }

  // Check for complex runs if we have a run of at least 3
  if (longestRun.length >= 3) {
    // Get all indices in the run
    const runIndices: number[] = [];
    longestRun.forEach(runValue => {
      const indices = cardFreq[runValue];
      if (indices) {
        runIndices.push(...indices);
      }
    });

    // Count frequencies in the run
    const runFreq: { [key: number]: number } = {};
    longestRun.forEach(runValue => {
      const indices = cardFreq[runValue];
      if (indices) {
        runFreq[runValue] = indices.length;
      }
    });

    const totalCardsInRun = runIndices.length;
    const runLength = longestRun.length;

    // Check for quadruple run of 3 (5 cards: 2,3,3,4,4)
    // Pattern: [1, 2, 2] - one value appears once, two values appear twice each
    if (runLength === 3 && totalCardsInRun === 5) {
      const freqCounts = Object.values(runFreq).sort((a, b) => a - b);
      if (
        freqCounts.length === 3 &&
        freqCounts[0] === 1 &&
        freqCounts[1] === 2 &&
        freqCounts[2] === 2
      ) {
        const cards = getCardsFromIndices(runIndices);
        breakdown.push(createBreakdownItem('QUADRUPLE_RUN_OF_3', 16, cards));
        runIndices.forEach(idx => usedIndices.add(idx));
      }
      // Check for triple run of 3 (5 cards: 2,3,4,4,4 or 2,2,2,3,4 or 2,2,3,3,4)
      // Pattern: [1, 1, 3] - two values appear once, one appears 3 times
      // OR: [1, 2, 2] but already checked above, so this is for [1, 1, 3] only
      else {
        const freqCounts = Object.values(runFreq).sort((a, b) => a - b);
        if (
          freqCounts.length === 3 &&
          freqCounts[0] === 1 &&
          freqCounts[1] === 1 &&
          freqCounts[2] === 3
        ) {
          const cards = getCardsFromIndices(runIndices);
          breakdown.push(createBreakdownItem('TRIPLE_RUN_OF_3', 15, cards));
          runIndices.forEach(idx => usedIndices.add(idx));
        }
      }
    }
    // Check for double run of 4 (5 cards: 2,3,4,5,5 or 2,2,3,4,5)
    else if (runLength === 4 && totalCardsInRun === 5) {
      // Must have 5 cards with 4 distinct run values, one duplicated
      const freqCounts = Object.values(runFreq).sort((a, b) => a - b);
      if (
        freqCounts[0] === 1 &&
        freqCounts[1] === 1 &&
        freqCounts[2] === 1 &&
        freqCounts[3] === 2
      ) {
        const cards = getCardsFromIndices(runIndices);
        breakdown.push(createBreakdownItem('DOUBLE_RUN_OF_4', 10, cards));
        runIndices.forEach(idx => usedIndices.add(idx));
      }
    }
    // Check for double run of 3 (4 cards: 2,3,4,4 or 2,2,3,4)
    else if (runLength === 3 && totalCardsInRun === 4) {
      // Must have 4 cards with 3 distinct run values, one duplicated
      const freqCounts = Object.values(runFreq).sort((a, b) => a - b);
      if (
        (freqCounts[0] === 1 && freqCounts[1] === 1 && freqCounts[2] === 2) ||
        (freqCounts[0] === 1 && freqCounts[1] === 2 && freqCounts[2] === 1)
      ) {
        const cards = getCardsFromIndices(runIndices);
        breakdown.push(createBreakdownItem('DOUBLE_RUN_OF_3', 8, cards));
        runIndices.forEach(idx => usedIndices.add(idx));
      }
    }
  }

  // 2. DETECT SIMPLE RUNS (only unused cards)
  if (usedIndices.size === 0 && longestRun.length >= 3) {
    const runIndices: number[] = [];
    longestRun.forEach(runValue => {
      const indices = cardFreq[runValue];
      if (indices) {
        runIndices.push(...indices);
      }
    });

    if (longestRun.length === 5) {
      const cards = getCardsFromIndices(runIndices);
      breakdown.push(createBreakdownItem('RUN_OF_5', 5, cards));
      runIndices.forEach(idx => usedIndices.add(idx));
    } else if (longestRun.length === 4) {
      const cards = getCardsFromIndices(runIndices);
      breakdown.push(createBreakdownItem('RUN_OF_4', 4, cards));
      runIndices.forEach(idx => usedIndices.add(idx));
    } else if (longestRun.length === 3) {
      const cards = getCardsFromIndices(runIndices);
      breakdown.push(createBreakdownItem('RUN_OF_3', 3, cards));
      runIndices.forEach(idx => usedIndices.add(idx));
    }
  }

  // 3. DETECT PAIRS/THREE OF A KIND/FOUR OF A KIND (only unused cards)
  const availableIndices = sortedCardValues
    .map((_, idx) => idx)
    .filter(idx => !usedIndices.has(idx));

  // Group available cards by runValue
  const availableByValue: { [key: number]: number[] } = {};
  availableIndices.forEach(idx => {
    const cardValue = sortedCardValues[idx];
    if (!cardValue) return;
    const runValue = cardValue.runValue;
    if (!availableByValue[runValue]) {
      availableByValue[runValue] = [];
    }
    availableByValue[runValue]!.push(idx);
  });

  // Check for four of a kind
  for (const [_runValue, indices] of Object.entries(availableByValue)) {
    if (indices.length === 4) {
      const cards = getCardsFromIndices(indices);
      breakdown.push(createBreakdownItem('FOUR_OF_A_KIND', 12, cards));
      indices.forEach(idx => usedIndices.add(idx));
    }
  }

  // Check for three of a kind (only if not already used)
  for (const [_runValue, indices] of Object.entries(availableByValue)) {
    if (indices.length === 3 && indices.every(idx => !usedIndices.has(idx))) {
      const cards = getCardsFromIndices(indices);
      breakdown.push(createBreakdownItem('THREE_OF_A_KIND', 6, cards));
      indices.forEach(idx => usedIndices.add(idx));
    }
  }

  // Check for pairs (only if not already used)
  for (const [_runValue, indices] of Object.entries(availableByValue)) {
    if (indices.length === 2 && indices.every(idx => !usedIndices.has(idx))) {
      const cards = getCardsFromIndices(indices);
      breakdown.push(createBreakdownItem('PAIR', 2, cards));
      indices.forEach(idx => usedIndices.add(idx));
    }
  }

  // 4. DETECT ALL FIFTEENS (all combinations, independent)
  const getCombinations = (arr: number[], size: number): number[][] => {
    if (size === 0) return [[]];
    if (arr.length < size) return [];
    const [first, ...rest] = arr;
    if (first === undefined) return [];
    const withFirst = getCombinations(rest, size - 1).map(combo => [
      first,
      ...combo,
    ]);
    const withoutFirst = getCombinations(rest, size);
    return [...withFirst, ...withoutFirst];
  };

  const allIndices = sortedCardValues.map((_, idx) => idx);
  for (let size = 2; size <= 5; size++) {
    const combinations = getCombinations(allIndices, size);
    for (const combination of combinations) {
      const sum = combination.reduce((acc, idx) => {
        const cardValue = sortedCardValues[idx];
        if (!cardValue) return acc;
        return acc + cardValue.pegValue;
      }, 0);
      if (sum === 15) {
        const cards = getCardsFromIndices(combination);
        breakdown.push(createBreakdownItem('FIFTEEN', 2, cards));
      }
    }
  }

  // 5. DETECT FLUSH (independent)
  const suits = hand.map(card => parseCard(card).suit);
  const allSameSuit = suits.every(suit => suit === suits[0]);
  const cutSuit = parseCard(cutCard).suit;

  if (allSameSuit) {
    if (suits[0] === cutSuit) {
      // Flush of 5
      breakdown.push(createBreakdownItem('FLUSH_5', 5, allCards));
    } else if (!isCrib) {
      // Flush of 4 (hand only, not crib)
      breakdown.push(createBreakdownItem('FLUSH_4', 4, hand));
    }
  }

  // 6. DETECT RIGHT JACK (independent)
  const cutSuitForJack = parseCard(cutCard).suit;
  const rightJackCard = hand.find(
    card => card.startsWith('JACK') && parseCard(card).suit === cutSuitForJack
  );
  if (rightJackCard) {
    breakdown.push(createBreakdownItem('RIGHT_JACK', 1, [rightJackCard]));
  }

  // Calculate total from breakdown
  const total = breakdown.reduce((sum, item) => sum + item.points, 0);

  return { total, breakdown };
};

/**
 * Score pegging stack with detailed breakdown
 * Returns both total score and itemized breakdown
 */
export const scorePeggingWithBreakdown = (
  peggingStack: Card[]
): { total: number; breakdown: ScoreBreakdownItem[] } => {
  const breakdown: ScoreBreakdownItem[] = [];
  const parsedStack = peggingStack.map(parseCard);

  // 1. Check for fifteen (sum of all cards = 15)
  const sum15 = parsedStack.reduce((acc, card) => acc + card.pegValue, 0);
  if (sum15 === 15) {
    breakdown.push(createBreakdownItem('PEGGING_FIFTEEN', 2, peggingStack));
  }

  // 2. Check for thirty-one (sum of all cards = 31)
  if (sum15 === 31) {
    breakdown.push(createBreakdownItem('PEGGING_THIRTY_ONE', 2, peggingStack));
  }

  // 3. Check for same rank sequences (from end of stack)
  if (peggingStack.length >= 2) {
    const lastCard = parsedStack[parsedStack.length - 1];
    let sameRankCount = 1;

    // Count how many cards from the end have the same rank
    for (let i = parsedStack.length - 2; i >= 0; i--) {
      const current = parsedStack[i];
      if (!current || !lastCard) break;
      if (current.runValue === lastCard.runValue) {
        sameRankCount++;
      } else {
        break;
      }
    }

    const lastCards = peggingStack.slice(-sameRankCount);

    if (sameRankCount === 4) {
      breakdown.push(
        createBreakdownItem('PEGGING_FOUR_OF_A_KIND', 12, lastCards)
      );
    } else if (sameRankCount === 3) {
      breakdown.push(
        createBreakdownItem('PEGGING_THREE_OF_A_KIND', 6, lastCards)
      );
    } else if (sameRankCount === 2) {
      breakdown.push(createBreakdownItem('PEGGING_PAIR', 2, lastCards));
    }
  }

  // 4. Check for runs (from end of stack, no duplicates)
  // Check from longest to shortest (7 down to 3)
  for (let length = 7; length >= 3; length--) {
    if (peggingStack.length < length) continue;

    const lastCards = peggingStack.slice(-length);
    const lastParsed = lastCards.map(parseCard);

    // Sort by runValue
    const sorted = [...lastParsed].sort((a, b) => a.runValue - b.runValue);

    // Check for duplicates
    let hasDuplicates = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (!current || !next) break;
      if (current.runValue === next.runValue) {
        hasDuplicates = true;
        break;
      }
    }

    if (hasDuplicates) continue;

    // Check if consecutive
    let isConsecutive = true;
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (!current || !next) {
        isConsecutive = false;
        break;
      }
      if (current.runValue + 1 !== next.runValue) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive) {
      const type: ScoreBreakdownType =
        length === 7
          ? 'PEGGING_RUN_OF_7'
          : length === 6
          ? 'PEGGING_RUN_OF_6'
          : length === 5
          ? 'PEGGING_RUN_OF_5'
          : length === 4
          ? 'PEGGING_RUN_OF_4'
          : 'PEGGING_RUN_OF_3';

      breakdown.push(createBreakdownItem(type, length, lastCards));
      break; // Only count longest run
    }
  }

  // Calculate total from breakdown
  const total = breakdown.reduce((sum, item) => sum + item.points, 0);

  return { total, breakdown };
};
