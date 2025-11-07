import { randomInt } from 'crypto';
import { CribbageGame } from '../core/CribbageGame';
import {
  GameAgent,
  Card,
  PlayerIdAndName,
  GameEvent,
  GameState,
  AgentDecisionType,
  GameSnapshot,
  ActionType,
} from '../types';
import { displayCard, parseCard, suitToEmoji } from '../core/scoring';
import EventEmitter from 'eventemitter3';
import dotenv from 'dotenv';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();
const startingScore = process.env.OVERRIDE_START_SCORE
  ? parseInt(process.env.OVERRIDE_START_SCORE)
  : 0;

export class GameLoop extends EventEmitter {
  public cribbageGame: CribbageGame;
  private agents: Record<string, GameAgent> = {};

  constructor(playersInfo: PlayerIdAndName[]) {
    super();
    this.cribbageGame = new CribbageGame(playersInfo, startingScore);
    this.cribbageGame.on('gameStateChange', (newGameState: GameState) => {
      this.emit('gameStateChange', newGameState);
    });
    this.cribbageGame.on('gameEvent', (gameEvent: GameEvent) => {
      this.emit('gameEvent', gameEvent);
    });
    this.cribbageGame.on('gameSnapshot', (newGameSnapshot: GameSnapshot) => {
      this.emit('gameSnapshot', newGameSnapshot);
    });
  }

  public addAgent(playerId: string, agent: GameAgent): void {
    this.agents[playerId] = agent;
  }

  /**
   * Map AgentDecisionType to corresponding WAITING_FOR_* ActionType
   * @param decisionType - The decision type to map
   * @returns The corresponding ActionType
   */
  private getWaitingActionType(decisionType: AgentDecisionType): ActionType {
    switch (decisionType) {
      case AgentDecisionType.DEAL:
        return ActionType.WAITING_FOR_DEAL;
      case AgentDecisionType.DISCARD:
        return ActionType.WAITING_FOR_DISCARD;
      case AgentDecisionType.PLAY_CARD:
        return ActionType.WAITING_FOR_PLAY_CARD;
      case AgentDecisionType.CONTINUE:
        return ActionType.WAITING_FOR_CONTINUE;
      default:
        throw new Error(`Unknown decision type: ${decisionType}`);
    }
  }

  /**
   * Request a decision from a player and record it in GameState/GameEvent
   * This helper method integrates decision requests into the canonical game state
   * Sets waiting state in GameState and records WAITING_FOR_* event in game history
   * @param playerId - ID of the player we're waiting on
   * @param decisionType - Type of decision being requested
   */
  private requestDecision(
    playerId: string,
    decisionType: AgentDecisionType
  ): void {
    const waitingActionType = this.getWaitingActionType(decisionType);
    this.cribbageGame.recordWaitingEvent(waitingActionType, playerId, decisionType);
  }

  private async sendContinue(
    playerID: string,
    continueDescription: string,
    sendWaitingForPlayer = true
  ): Promise<void> {
    const agent = this.agents[playerID];
    if (agent.waitForContinue) {
      if (sendWaitingForPlayer) {
        // Request decision and record in GameState/GameEvent
        this.requestDecision(playerID, AgentDecisionType.CONTINUE);
      }
      await agent.waitForContinue(
        this.cribbageGame.getGameState(),
        playerID,
        continueDescription
      );
      console.log(`Player ${playerID} is ready to continue`);
    }
  }

  private async doPegging(): Promise<string | null> {
    // start with person after dealer for the initial card
    // each person chooses a card to play
    // if the person is in the peggingGoPlayers array, then skip them since we already know they can't play
    // if someone's score reaches 121 or higher, they win
    // the playCard function returns a player ID if the pegging round is over
    // if the round is over:
    // start next round with the person following the last person to play a card(return value of playCard)
    // if the round is not over:
    // continue with the next player
    // if a player has no cards left to play, move on to the next player
    // once all players have no cards left to play, pegging is over (call game.endPegging)

    let currentPlayerId = this.cribbageGame.getFollowingPlayerId(
      this.cribbageGame.getDealerId()
    );
    const playersDone: string[] = []; // list of player ids who have no cards left to play
    let roundOverLastPlayer: string | null = null;
    while (
      playersDone.length < this.cribbageGame.getGameState().players.length
    ) {
      // if the current player has no cards left to play, move on to the next player
      if (playersDone.includes(currentPlayerId)) {
        console.log(
          `Player ${currentPlayerId} has no cards left to play. Moving on to the next player.`
        );
        currentPlayerId =
          this.cribbageGame.getFollowingPlayerId(currentPlayerId);
        continue;
      } else {
        console.log(`Player ${currentPlayerId}'s turn to play a card.`);
      }

      // if the current player has already said "Go", move on to the next player
      if (
        this.cribbageGame
          .getGameState()
          .peggingGoPlayers.includes(currentPlayerId)
      ) {
        currentPlayerId =
          this.cribbageGame.getFollowingPlayerId(currentPlayerId);
        continue;
      }

      const agent = this.agents[currentPlayerId];
      if (!agent) throw new Error(`No agent for player ${currentPlayerId}`);

      // Request decision and record in GameState/GameEvent
      this.requestDecision(currentPlayerId, AgentDecisionType.PLAY_CARD);

      // get the card the agent wants to play
      console.log(`Calling makeMove for player ${currentPlayerId}`);
      const card = await agent.makeMove(
        this.cribbageGame.getGameState(),
        currentPlayerId
      );
      roundOverLastPlayer = this.cribbageGame.playCard(currentPlayerId, card);
      const parsedStack = this.cribbageGame
        .getGameState()
        .peggingStack.map(parseCard);
      console.log(
        `Full pegging stack: ${parsedStack
          .map(card => `${card.runValue}${suitToEmoji(card.suit)}`)
          .join(', ')}`
      );
      // if current player pegged out, return their ID as winner of game
      if (this.cribbageGame.getPlayer(currentPlayerId).score > 120) {
        console.log(
          `Player ${currentPlayerId} pegged out with score ${
            this.cribbageGame.getPlayer(currentPlayerId).score
          }`
        );
        return Promise.resolve(currentPlayerId);
      }

      // // if player is out of cards now, add them to the list of players done
      // if (this.game.getPlayer(currentPlayer).peggingHand.length === 0) {
      //   playersDone.push(currentPlayer);
      // }

      // if the round is over, start next round with the person following the last person to play a card
      if (roundOverLastPlayer) {
        currentPlayerId =
          this.cribbageGame.getFollowingPlayerId(roundOverLastPlayer);
        // update the list of players done - check all players to see if they are out of cards
        for (const player of this.cribbageGame.getGameState().players) {
          if (
            player.peggingHand.length === 0 &&
            !playersDone.includes(player.id)
          ) {
            playersDone.push(player.id);
          }
        }
      }
      // if the round is not over, continue with the next player
      else {
        currentPlayerId =
          this.cribbageGame.getFollowingPlayerId(currentPlayerId);
      }
    }
    // if all players are out of cards, pegging is over
    this.cribbageGame.endPegging();
    console.log('PEGGING OVER\n');

    // if no one has pegged out, return null to indicate no winner
    return Promise.resolve(null);
  }

  private async doRound(): Promise<string | null> {
    // start the round (cleanup and reset state and rotate dealer)
    this.cribbageGame.startRound();

    // Prompt the dealer to deal
    const dealer = this.cribbageGame.getPlayer(this.cribbageGame.getDealerId());
    // Request decision and record in GameState/GameEvent
    this.requestDecision(dealer.id, AgentDecisionType.DEAL);
    await this.sendContinue(dealer.id, 'Deal the cards');
    // await this.sendContinue(dealer.id, 'Shuffle the cards');
    this.cribbageGame.deal();

    // Crib phase: Agents discard to crib
    for (const player of this.cribbageGame.getGameState().players) {
      const agent = this.agents[player.id];
      if (!agent) throw new Error(`No agent for player ${player.id}`);
      // Request decision and record in GameState/GameEvent
      this.requestDecision(player.id, AgentDecisionType.DISCARD);
      const discards = await agent.discard(
        this.cribbageGame.getGameState(),
        player.id,
        this.cribbageGame.getGameState().players.length === 2 ? 2 : 1
      );
      this.cribbageGame.discardToCrib(player.id, discards);
    }

    this.cribbageGame.completeCribPhase();

    // Cutting phase: Agents cut the deck
    const dealerIndex = this.cribbageGame
      .getGameState()
      .players.findIndex(player => player.isDealer);
    const behindDealerIndex =
      (dealerIndex - 1 + this.cribbageGame.getGameState().players.length) %
      this.cribbageGame.getGameState().players.length;
    const behindDealer =
      this.cribbageGame.getGameState().players[behindDealerIndex];
    // prompt user to continue to initiate cutting the deck
    await this.sendContinue(behindDealer.id, 'Cut the deck');
    this.cribbageGame.cutDeck(
      behindDealer.id,
      randomInt(0, this.cribbageGame.getGameState().deck.length)
    );

    const turnCard = this.cribbageGame.getGameState().turnCard;
    if (!turnCard) throw new Error('No turn card after cutting deck');
    console.log(
      `Player ${behindDealer.name} cut the deck: ${displayCard(turnCard)}`
    );

    // Pegging phase: Agents play cards until no more cards can be played
    const peggingWinner = await this.doPegging();
    if (peggingWinner) {
      console.log(`PLAYER ${peggingWinner} WINS BY PEGGING!!!`);
      return peggingWinner;
    }

    // send continue to all players before continuing to counting phase
    const continueToScoringPromises = this.cribbageGame
      .getGameState()
      .players.map(player =>
        this.sendContinue(player.id, 'Ready for counting', false)
      );
    await Promise.all(continueToScoringPromises);

    // SCORING PHASE
    // Loop through each player and score their hand, starting with player after dealer and ending with dealer
    // Dealer also scores their crib after scoring their hand
    const afterDealerIndex =
      (dealerIndex + 1) % this.cribbageGame.getGameState().players.length;
    for (let n = 0; n < this.cribbageGame.getGameState().players.length; n++) {
      const i =
        (afterDealerIndex + n) %
        this.cribbageGame.getGameState().players.length;
      const player = this.cribbageGame.getGameState().players[i];
      const agent = this.agents[player.id];
      if (!agent) throw new Error(`No agent for player ${player.id}`);
      // await this.sendContinue(player.id, 'Score hand');
      const handScore = this.cribbageGame.scoreHand(player.id);
      console.log(
        `Player ${player.name} scored ${handScore} points hand: 
        ${player.hand.map(card => displayCard(card)).join(', ')}`
      );

      // if player wins by scoring their hand
      if (player.score > 120) return player.id;

      if (player.isDealer) {
        // await this.sendContinue(player.id, 'Score crib');
        const cribScore = this.cribbageGame.scoreCrib(player.id);
        console.log(
          `Player ${player.name} scored ${cribScore} points in their crib: 
          ${this.cribbageGame
            .getCrib()
            .map((card: Card) => displayCard(card))
            .join(', ')}`
        );
      }

      // if player wins by scoring their crib
      if (player.score > 120) return player.id;
    }

    // record end_phase event for the scoring phase
    this.cribbageGame.endScoring();

    // Send wait request to all players in parallel and once all are done, continue
    const continueToNextRoundPromises = this.cribbageGame
      .getGameState()
      .players.map(player =>
        this.sendContinue(player.id, 'Ready for next round', false)
      );
    await Promise.all(continueToNextRoundPromises);

    console.log('All players ready for next round');

    // log the scores of each player
    for (const player of this.cribbageGame.getGameState().players) {
      console.log(`Player ${player.name} score: ${player.score}`);
    }

    return null;
  }

  /**
   * Runs the entire game loop until a player wins
   * @returns the ID of the winning player
   */
  public async playGame(): Promise<string> {
    let winner: string | null = null;

    while (!winner) {
      winner = await this.doRound();
    }

    this.cribbageGame.endGame(winner);

    return Promise.resolve(winner);
  }
}
