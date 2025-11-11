import { ActionType, Card, GameEvent, GameState, Player } from '../types';
import { parseCard, sumOfPeggingStack } from './scoring';

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
    const validCards = [];
    // Filter out UNKNOWN cards (redacted cards) before checking
    const knownCards = player.peggingHand.filter(c => c !== 'UNKNOWN');
    for (const c of knownCards) {
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
  // Note: card should never be UNKNOWN here (only current player's cards), but check anyway
  if (card === 'UNKNOWN') {
    return false;
  }
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
    // Filter out UNKNOWN cards (redacted cards) before checking
    const knownCards = player.peggingHand.filter(c => c !== 'UNKNOWN');
    const validCards = knownCards.filter(
      c => currentSum + parseCard(c).pegValue <= 31
    );
    if (validCards.length !== 0) {
      return 'You have a valid card to play and cannot say "Go"';
    }
    return null;
  }
  // Check if the card can be played without exceeding 31
  // Note: card should never be UNKNOWN here (only current player's cards), but check anyway
  if (card === 'UNKNOWN') {
    return 'Cannot play unknown card';
  }
  if (!player.peggingHand.includes(card)) {
    return 'Card not in hand';
  }
  if (currentSum + parseCard(card).pegValue > 31) {
    return 'Card would exceed 31';
  }
  return null;
}

export function handHasValidPlay(game: GameState, hand: Card[]): boolean {
  const currentSum = sumOfPeggingStack(game.peggingStack);
  // Filter out UNKNOWN cards (redacted cards) before checking
  const knownCards = hand.filter(card => card !== 'UNKNOWN');
  return (
    knownCards.length > 0 &&
    knownCards.some(card => currentSum + parseCard(card).pegValue <= 31)
  );
}

export function playerHasValidPlay(game: GameState, player: Player): boolean {
  return handHasValidPlay(game, player.peggingHand);
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
