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

  const mult = longestRun.reduce(
    (acc, card) => acc * (cardFreq[card] || 1),
    1
  );
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

export const scoreHand = (
  hand: Card[],
  cutCard: Card,
  isCrib: boolean
): number => {
  if (hand.length !== 4) {
    throw new Error('Hand must contain exactly 4 cards.');
  }

  const sortedCards = sortCards(hand, cutCard);
  let totalScore = 0;

  totalScore += rightJack(hand, cutCard);
  totalScore += flush(hand, cutCard, isCrib);
  totalScore += countFifteens(sortedCards);
  totalScore += score_runs(sortedCards);
  totalScore += pairs(sortedCards);

  // let debug_str = '';

  // console.debug('Cards: ', sortedCards);
  // console.debug('Runs: ', score_runs(sortedCards));
  // console.debug('Pairs: ', pairs(sortedCards));
  // debug_str += `Cards:\n${sortedCards
  //   .map(card => `${card.runValue} of ${card.suit}`)
  //   .join('\n')}\n`;
  // debug_str += `Runs: ${score_runs(sortedCards)}\n`;
  // debug_str += `Pairs: ${pairs(sortedCards)} \n`;

  // console.debug(debug_str);

  return totalScore;
};
