import { ActionType, Card, GameEvent, GameState, Player } from '../types/index.js';
import { parseCard, sumOfPeggingStack } from './scoring.js';

export function isValidDiscard(
  game: GameState,
  player: Player,
  cards: Card[]
): boolean {
  return cards.every(card => player.hand.includes(card));
}

export function isValidPeggingPlay(
  game: GameState,
  player: Player,
  card: Card | null
): boolean {
  const currentSum = sumOfPeggingStack(game.peggingStack);
  if (card === null) {
    console.log('Trying to say "Go"');
    // Check if the player has any valid card to play
    // return !player.peggingHand.some(
    //   c => currentSum + parseCard(c).pegValue <= 31
    // );
    const validCards = [];
    for (const c of player.peggingHand) {
      if (currentSum + parseCard(c).pegValue <= 31) {
        validCards.push(c);
      }
    }
    console.log('Valid cards are: ', validCards);
    console.log('length of valid cards: ', validCards.length);
    console.log('Current sum is: ', currentSum);
    if (validCards.length === 0) {
      console.log("Not allowed to say 'Go'. Valid cards are: ", validCards);
    }
    return validCards.length === 0;
  }
  // Check if the card can be played without exceeding 31
  return (
    player.peggingHand.includes(card) &&
    currentSum + parseCard(card).pegValue <= 31
  );
}

export function getInvalidPeggingPlayReason(
  game: GameState,
  player: Player,
  card: Card | null
): string | null {
  const currentSum = sumOfPeggingStack(game.peggingStack);
  if (card === null) {
    // Check if the player has any valid card to play
    const validCards = player.peggingHand.filter(
      c => currentSum + parseCard(c).pegValue <= 31
    );
    if (validCards.length !== 0) {
      return 'You have a valid card to play and cannot say "Go"';
    }
    return null;
  }
  // Check if the card can be played without exceeding 31
  if (!player.peggingHand.includes(card)) {
    return 'Card not in hand';
  }
  if (currentSum + parseCard(card).pegValue > 31) {
    return 'Card would exceed 31';
  }
  return null;
}

export function getMostRecentGameEventForPlayer(
  gameEventHistory: GameEvent[],
  playerId: string
): GameEvent | null {
  for (let i = gameEventHistory.length - 1; i >= 0; i--) {
    if (gameEventHistory[i].playerId === playerId) {
      return gameEventHistory[i];
    }
  }
  return null;
}

export function isScoreableEvent(event: GameEvent): boolean {
  // it doesn't matter if score occurred or not
  // we care about if this type of event can be scored
  return (
    event.actionType === ActionType.SCORE_HEELS ||
    event.actionType === ActionType.LAST_CARD ||
    event.actionType === ActionType.SCORE_HAND ||
    event.actionType === ActionType.SCORE_CRIB ||
    event.actionType === ActionType.PLAY_CARD
  );
}

export function getMostRecentScoreableEventForPlayer(
  gameEventHistory: GameEvent[],
  playerId: string
): GameEvent | null {
  for (let i = gameEventHistory.length - 1; i >= 0; i--) {
    if (
      gameEventHistory[i].playerId === playerId &&
      isScoreableEvent(gameEventHistory[i])
    ) {
      return gameEventHistory[i];
    }
  }
  return null;
}

export function getMostRecentEventForPlayerByActionType(
  gameEventHistory: GameEvent[],
  playerId: string,
  actionType: ActionType
): GameEvent | null {
  for (let i = gameEventHistory.length - 1; i >= 0; i--) {
    if (
      gameEventHistory[i].playerId === playerId &&
      gameEventHistory[i].actionType === actionType
    ) {
      return gameEventHistory[i];
    }
  }
  return null;
}
