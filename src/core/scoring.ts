import { Card } from '../types'; // Assuming this is the file where the Card type is defined.

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
  return {
    pegValue,
    runValue,
    suit: card.split('_')[1],
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
      const sum = combination.reduce(
        (acc, index) => acc + cards[index].pegValue,
        0
      );
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
    if (i === 0 || keys[i] === keys[i - 1] + 1) {
      // If the current key is consecutive, add it to the current run
      currentRun.push(keys[i]);
    } else {
      // Otherwise, compare and reset the current run
      if (currentRun.length > longestRun.length) {
        longestRun = currentRun;
      }
      currentRun = [keys[i]];
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
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].runValue === cards[j].runValue) {
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

const scorePeggingSameRank = (peggingStack: CardValue[]): number => {
  // start at the most recent card played (last card in the stack) and iterate backwards
  // count how many cards in a row have the same rank
  // stop when a card with a different rank is found

  let score = 0;
  let i = peggingStack.length - 1;
  while (i > 0 && peggingStack[i].runValue === peggingStack[i - 1].runValue) {
    i--;
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
    if (cards[i].runValue + 1 !== cards[i + 1].runValue) {
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
    const has_duplicates = sorted_slice.some(
      (card, index) =>
        sorted_slice[index + 1] &&
        card.runValue === sorted_slice[index + 1].runValue
    );
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
  console.debug(
    `Full pegging stack: ${parsedStack
      .map(card => `${card.runValue}${suitToEmoji(card.suit)}`)
      .join(', ')}`
  );
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
