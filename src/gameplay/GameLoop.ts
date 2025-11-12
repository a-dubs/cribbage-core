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
  DecisionRequest,
  DecisionRequestData,
  PlayCardRequestData,
  DiscardRequestData,
  DealRequestData,
  CutDeckRequestData,
  AcknowledgeRequestData,
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
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `request-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Request a decision from a player
   * Creates a DecisionRequest and adds it to pending requests
   * @param playerId - ID of the player we're waiting on
   * @param decisionType - Type of decision required
   * @param requestData - Context-specific data for the request
   * @returns The created DecisionRequest
   */
  private requestDecision(
    playerId: string,
    decisionType: AgentDecisionType,
    requestData: DecisionRequestData
  ): DecisionRequest {
    const request: DecisionRequest = {
      requestId: this.generateRequestId(),
      playerId,
      decisionType,
      requestData,
      required: true, // All decisions block flow
      timestamp: new Date(),
    };

    this.cribbageGame.addDecisionRequest(request);
    // Emit a GameSnapshot immediately so agents can see the new request
    // This is needed for WebSocketAgent which relies on mostRecentGameSnapshot
    const currentState = this.cribbageGame.getGameState();
    const currentEvent = this.cribbageGame.getGameSnapshotHistory().length > 0
      ? this.cribbageGame.getGameSnapshotHistory()[this.cribbageGame.getGameSnapshotHistory().length - 1].gameEvent
      : null;
    const snapshot: GameSnapshot = {
      gameState: currentState,
      gameEvent: currentEvent || {
        gameId: currentState.id,
        phase: currentState.currentPhase,
        actionType: ActionType.START_ROUND,
        playerId: null,
        cards: null,
        scoreChange: 0,
        timestamp: new Date(),
        snapshotId: currentState.snapshotId,
      },
      pendingDecisionRequests: this.cribbageGame.getPendingDecisionRequests(),
    };
    this.cribbageGame.emit('gameSnapshot', snapshot);

    return request;
  }

  /**
   * Wait for a decision response
   * Calls appropriate agent method based on decision type
   * @param request - The decision request to wait for
   * @returns The response from the agent
   */
  private async waitForDecision(request: DecisionRequest): Promise<any> {
    const agent = this.agents[request.playerId];
    if (!agent) throw new Error(`No agent for player ${request.playerId}`);

    console.log(`[waitForDecision] Starting for player ${request.playerId}, type ${request.decisionType}, agent is ${agent.human ? 'human' : 'bot'}`);

    // Get redacted snapshot for this player
    const redactedSnapshot = this.cribbageGame.getRedactedGameSnapshot(
      request.playerId
    );

    switch (request.decisionType) {
      case AgentDecisionType.PLAY_CARD: {
        const card = await agent.makeMove(redactedSnapshot, request.playerId);
        this.cribbageGame.removeDecisionRequest(request.requestId);
        console.log(`[waitForDecision] PLAY_CARD resolved for player ${request.playerId}`);
        return card;
      }

      case AgentDecisionType.DISCARD: {
        const data = request.requestData as DiscardRequestData;
        console.log(`[waitForDecision] Calling agent.discard() for player ${request.playerId} (${agent.human ? 'human' : 'bot'})`);
        const discards = await agent.discard(
          redactedSnapshot,
          request.playerId,
          data.numberOfCardsToDiscard
        );
        console.log(`[waitForDecision] DISCARD resolved for player ${request.playerId}, got ${discards.length} cards`);
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return discards;
      }

      case AgentDecisionType.DEAL: {
        if (agent.deal) {
          await agent.deal(redactedSnapshot, request.playerId);
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        this.cribbageGame.deal(); // Trigger the actual deal action
        return;
      }

      case AgentDecisionType.CUT_DECK: {
        if (agent.cutDeck) {
          const cutData = request.requestData as CutDeckRequestData;
          const cutIndex = await agent.cutDeck(
            redactedSnapshot,
            request.playerId,
            cutData.maxIndex
          );
          this.cribbageGame.removeDecisionRequest(request.requestId);
          this.cribbageGame.cutDeck(request.playerId, cutIndex);
          return cutIndex;
        }
        break;
      }

      case AgentDecisionType.READY_FOR_COUNTING: {
        if (agent.acknowledgeReadyForCounting) {
          await agent.acknowledgeReadyForCounting(
            redactedSnapshot,
            request.playerId
          );
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return;
      }

      case AgentDecisionType.READY_FOR_NEXT_ROUND: {
        if (agent.acknowledgeReadyForNextRound) {
          await agent.acknowledgeReadyForNextRound(
            redactedSnapshot,
            request.playerId
          );
        }
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return;
      }
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

      // Request decision
      const gameState = this.cribbageGame.getGameState();
      const player = gameState.players.find(p => p.id === currentPlayerId);
      if (!player) throw new Error(`Player ${currentPlayerId} not found`);

      const playCardRequest = this.requestDecision(
        currentPlayerId,
        AgentDecisionType.PLAY_CARD,
        {
          peggingHand: player.peggingHand,
          peggingStack: gameState.peggingStack,
          playedCards: gameState.playedCards,
          peggingTotal: gameState.peggingTotal,
        }
      );

      // Wait for decision
      console.log(`Calling makeMove for player ${currentPlayerId}`);
      const card = await this.waitForDecision(playCardRequest);
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

  /**
   * Parallel discarding phase - all players discard simultaneously
   */
  private async doCribPhase(): Promise<void> {
    // Request discards from ALL players in parallel
    const discardRequests: DecisionRequest[] = [];
    const gameState = this.cribbageGame.getGameState();
    const numberOfCardsToDiscard =
      gameState.players.length === 2 ? 2 : 1;

    for (const player of gameState.players) {
      const request = this.requestDecision(
        player.id,
        AgentDecisionType.DISCARD,
        {
          hand: player.hand,
          numberOfCardsToDiscard,
        }
      );
      discardRequests.push(request);
    }

    // Wait for all discards in parallel
    console.log(`[doCribPhase] Requesting discards from ${discardRequests.length} players in parallel`);
    const discardPromises = discardRequests.map(request => {
      console.log(`[doCribPhase] Starting waitForDecision for player ${request.playerId}`);
      return this.waitForDecision(request);
    });
    console.log(`[doCribPhase] All promises created, waiting for Promise.all()...`);
    const allDiscards = await Promise.all(discardPromises);
    console.log(`[doCribPhase] All discards received:`, allDiscards.map((d, i) => ({ player: discardRequests[i].playerId, count: d.length })));

    // Apply all discards
    for (let i = 0; i < gameState.players.length; i++) {
      const player = gameState.players[i];
      const discards = allDiscards[i];
      this.cribbageGame.discardToCrib(player.id, discards);
    }

    this.cribbageGame.completeCribPhase();
  }

  /**
   * Wait for all players to acknowledge (parallel, blocking)
   * @param decisionType - The acknowledgment type
   * @param message - User-friendly message
   */
  private async waitForAllPlayersReady(
    decisionType:
      | AgentDecisionType.READY_FOR_COUNTING
      | AgentDecisionType.READY_FOR_NEXT_ROUND,
    message: string
  ): Promise<void> {
    // Request acknowledgments from ALL players in parallel
    const acknowledgeRequests: DecisionRequest[] = [];
    const gameState = this.cribbageGame.getGameState();

    for (const player of gameState.players) {
      const request = this.requestDecision(player.id, decisionType, {
        message,
      });
      acknowledgeRequests.push(request);
    }

    // Wait for all acknowledgments in parallel
    // Each player can acknowledge independently
    const acknowledgePromises = acknowledgeRequests.map(request =>
      this.waitForDecision(request)
    );

    // Wait for all to complete (blocking)
    await Promise.all(acknowledgePromises);

    // All players have acknowledged - proceed
  }

  private async doRound(): Promise<string | null> {
    // start the round (cleanup and reset state and rotate dealer)
    this.cribbageGame.startRound();

    // DEAL: Explicit decision request (not continue)
    const dealer = this.cribbageGame.getPlayer(this.cribbageGame.getDealerId());
    const dealRequest = this.requestDecision(
      dealer.id,
      AgentDecisionType.DEAL,
      { canShuffle: true } // Future: allow shuffling
    );
    await this.waitForDecision(dealRequest);
    // deal() is called inside waitForDecision after agent responds

    // DISCARD: Parallel (all players at once)
    await this.doCribPhase();

    // CUT_DECK: Explicit decision request (not continue)
    const dealerIndex = this.cribbageGame
      .getGameState()
      .players.findIndex(player => player.isDealer);
    const behindDealerIndex =
      (dealerIndex - 1 + this.cribbageGame.getGameState().players.length) %
      this.cribbageGame.getGameState().players.length;
    const behindDealer =
      this.cribbageGame.getGameState().players[behindDealerIndex];
    const gameState = this.cribbageGame.getGameState();
    const cutRequest = this.requestDecision(
      behindDealer.id,
      AgentDecisionType.CUT_DECK,
      {
        maxIndex: gameState.deck.length - 1,
        deckSize: gameState.deck.length,
      }
    );
    await this.waitForDecision(cutRequest);
    // cutDeck() is called inside waitForDecision with returned index

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

    // READY_FOR_COUNTING: Parallel acknowledgment (all players)
    await this.waitForAllPlayersReady(
      AgentDecisionType.READY_FOR_COUNTING,
      'Ready for counting'
    );

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

    // READY_FOR_NEXT_ROUND: Parallel acknowledgment (all players)
    await this.waitForAllPlayersReady(
      AgentDecisionType.READY_FOR_NEXT_ROUND,
      'Ready for next round'
    );

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
