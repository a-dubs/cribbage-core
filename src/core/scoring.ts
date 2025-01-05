import { Card } from '../types'; // Assuming this is the file where the Card type is defined.

type CardValue = {
  value: number;
  suit: string;
};

const pegValue = (card: Card): number => {
  const rank = card.split('_')[0];
  if (rank === 'ACE') return 1;
  if (['JACK', 'QUEEN', 'KING'].includes(rank)) return 10;
  return parseInt(rank);
};

const parseCard = (card: Card): CardValue => {
  return {
    value: pegValue(card),
    suit: card.split('_')[1],
  };
};

const sortCards = (hand: Card[], cutCard: Card): CardValue[] => {
  return [...hand.map(parseCard), parseCard(cutCard)].sort(
    (a, b) => a.value - b.value
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
        (acc, index) => acc + cards[index].value,
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

const runs = (cards: CardValue[]): number => {
  let score = 0;
  for (let i = 0; i < cards.length - 2; i++) {
    let runLength = 1;
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[j].value === cards[j - 1].value + 1) {
        runLength++;
      } else {
        break;
      }
    }
    if (runLength >= 3) {
      score += runLength;
      break;
    }
  }
  return score;
};

const pairs = (cards: CardValue[]): number => {
  let score = 0;
  for (let i = 0; i < cards.length - 1; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].value === cards[j].value) {
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
  totalScore += countFifteens(sortedCards); // Single call to count fifteens
  totalScore += runs(sortedCards);
  totalScore += pairs(sortedCards);

  return totalScore;
};
