import { CribbageGame } from '../core/CribbageGame';
import { parseCard, scoreHand, scorePegging } from '../core/scoring';
import { GameState, Card } from '../types';
import { RandomAgent } from './RandomAgent';

const AGENT_ID = 'simple-bot-v1.0';
const DEBUG_TIMING = process.env.DEBUG_SIMPLE_AGENT_TIMING === 'true';

export class SimpleAgent extends RandomAgent {
  playerId: string = AGENT_ID;
  human = false;
  cribbageGame: CribbageGame = new CribbageGame([]);

  constructor() {
    super();
  }

  private getBestHand(hand: Card[]): Card[] {
    const startTime = DEBUG_TIMING ? Date.now() : 0;
    // score all possible hands with all possible discards with any possible remaining cut card
    // choose the discard that results in the highest score
    let bestHand = hand.slice(0, 4);
    let bestScore = 0;

    const possibleTurnCards = this.cribbageGame
      .generateDeck()
      .filter(card => !hand.includes(card));
    for (const discard1 of hand) {
      for (const discard2 of hand) {
        if (discard1 === discard2) {
          continue;
        }
        const scores: number[] = [];
        for (const turnCard of possibleTurnCards) {
          const score = scoreHand(
            hand.filter(card => card !== discard1 && card !== discard2),
            turnCard,
            false
          );
          scores.push(score);
        }
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avgScore > bestScore) {
          bestScore = avgScore;
          bestHand = hand.filter(
            card => card !== discard1 && card !== discard2
          );
        }
      }
    }
    if (DEBUG_TIMING) {
      const duration = Date.now() - startTime;
      console.log(`[SimpleAgent.getBestHand] ${duration}ms for hand of ${hand.length} cards`);
    }
    return bestHand;
  }

  discard(
    game: GameState,
    playerId: string,
    numberOfCardsToDiscard: number
  ): Promise<Card[]> {
    const startTime = DEBUG_TIMING ? Date.now() : 0;
    // score all possible hands with all possible discards with any possible remaining cut card
    // choose the discard that results in the highest score

    const player = game.players.find(p => p.id === playerId);
    if (!player || player.hand.length < numberOfCardsToDiscard) {
      throw new Error('Not enough cards to discard.');
    }

    const bestHand = this.getBestHand(player.hand);
    const discards = player.hand.filter(card => !bestHand.includes(card));
    
    if (DEBUG_TIMING) {
      const duration = Date.now() - startTime;
      console.log(`[SimpleAgent.discard] ${duration}ms for player ${playerId}`);
    }
    
    return Promise.resolve(discards);
  }

  makeMove(game: GameState, playerId: string): Promise<Card | null> {
    const startTime = DEBUG_TIMING ? Date.now() : 0;
    // filter by cards that can be played (sum of stack + card <= 31) using game.peggingStack
    // then choose the card that would result in the highest potential net score (score earned - score given to opponent)
    // for score earned, calculate how many points would be earned by playing each card
    // for score given to opponent, for each card we are considering playing, calculate the AVERAGE of
    // how many points the opponent could potentially earn by checking all cards not in our hand and not in the stack
    // and not the turn card
    // then subtract the average score from the score earned to get the net score
    // choose the card with the highest net score
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
      throw new Error('Player not found.');
    }

    if (player.peggingHand.length === 0) {
      return Promise.resolve(null);
    }

    const parseStartTime = DEBUG_TIMING ? Date.now() : 0;
    const parsedHand = player.peggingHand.map(card => parseCard(card));
    const parsedStack = game.peggingStack.map(card => parseCard(card));
    // filter full deck by:
    // - game.playedCards to get all cards that have been played
    // - this player's hand to get all cards that are in the player's hand
    // - game.turnCard to get the turn card
    const possibleRemainingCards = this.cribbageGame
      .generateDeck()
      .filter(
        card =>
          !game.playedCards.some(playedCard => playedCard.card === card) &&
          !player.peggingHand.includes(card) &&
          card !== game.turnCard
      );
    const parseDuration = DEBUG_TIMING ? Date.now() - parseStartTime : 0;

    const filterStartTime = DEBUG_TIMING ? Date.now() : 0;
    const parsedValidPlayedCards = parsedHand.filter(card => {
      const sum = parsedStack.reduce(
        (acc, c) => acc + c.pegValue,
        card.pegValue
      );
      return sum <= 31;
    });

    if (parsedValidPlayedCards.length === 0) {
      return Promise.resolve(null);
    }

    const validPlayedCards = player.peggingHand.filter(card =>
      parsedValidPlayedCards.some(c => c.runValue === parseCard(card).runValue)
    );
    const filterDuration = DEBUG_TIMING ? Date.now() - filterStartTime : 0;

    const scoringStartTime = DEBUG_TIMING ? Date.now() : 0;
    const cardNetScores: { card: Card; netScore: number }[] = [];
    for (const card of validPlayedCards) {
      const scoreEarned = scorePegging(game.peggingStack.concat(card));
      const scoresGiven: number[] = [];
      // calculate the possible scores the opponent could earn by playing each possible remaining card
      for (const remainingCard of possibleRemainingCards) {
        const scores: number[] = [];
        for (const opponentCard of possibleRemainingCards) {
          if (opponentCard === remainingCard) {
            continue;
          }
          const score = scorePegging(
            game.peggingStack.concat(remainingCard, opponentCard)
          );
          scores.push(score);
        }
        scoresGiven.push(scores.reduce((a, b) => a + b, 0) / scores.length);
      }

      // now take the average of the scores given to the opponent
      const avgScoreGiven =
        scoresGiven.reduce((a, b) => a + b, 0) / scoresGiven.length;
      const netScore = scoreEarned - avgScoreGiven;
      cardNetScores.push({ card, netScore });
    }
    const scoringDuration = DEBUG_TIMING ? Date.now() - scoringStartTime : 0;
    
    const selectStartTime = DEBUG_TIMING ? Date.now() : 0;
    const bestCard = cardNetScores.reduce((a, b) =>
      a.netScore > b.netScore ? a : b
    );
    const selectDuration = DEBUG_TIMING ? Date.now() - selectStartTime : 0;
    
    if (DEBUG_TIMING) {
      const totalDuration = Date.now() - startTime;
      console.log(`[SimpleAgent.makeMove] ${totalDuration}ms total (parse: ${parseDuration}ms, filter: ${filterDuration}ms, scoring: ${scoringDuration}ms, select: ${selectDuration}ms)`);
      console.log(`  - Valid cards: ${validPlayedCards.length}, Possible remaining: ${possibleRemainingCards.length}`);
    }
    
    return Promise.resolve(bestCard.card);
  }
}
