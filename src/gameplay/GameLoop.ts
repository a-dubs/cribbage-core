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
  Phase,
  DecisionRequest,
  DecisionRequestData,
  PlayCardRequestData,
  DiscardRequestData,
  DealRequestData,
  CutDeckRequestData,
  SelectDealerCardRequestData,
  AcknowledgeRequestData,
} from '../types';
import { displayCard, parseCard, suitToEmoji } from '../core/scoring';
import EventEmitter from 'eventemitter3';
import dotenv from 'dotenv';
import { getPlayerCountConfig } from './rules';
import { logger } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();
const startingScore = process.env.OVERRIDE_START_SCORE
  ? parseInt(process.env.OVERRIDE_START_SCORE)
  : 0;
// Feature flag for READY_FOR_COUNTING decision request (defaults to disabled)
const ENABLE_READY_FOR_COUNTING = process.env.ENABLE_READY_FOR_COUNTING === 'true';

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
   * Emit a GameSnapshot with updated pendingDecisionRequests (for acknowledgments)
   * This allows the app to see when players acknowledge without waiting for a game event
   */
  private emitAcknowledgmentSnapshot(): void {
    const currentState = this.cribbageGame.getGameState();
    const latestSnapshots = this.cribbageGame.getGameSnapshotHistory();
    const latestEvent = latestSnapshots.length > 0
      ? latestSnapshots[latestSnapshots.length - 1].gameEvent
      : {
          gameId: currentState.id,
          phase: currentState.currentPhase,
          actionType: ActionType.START_ROUND,
          playerId: null,
          cards: null,
          scoreChange: 0,
          timestamp: new Date(),
          snapshotId: currentState.snapshotId,
        };
    const snapshot: GameSnapshot = {
      gameState: currentState,
      gameEvent: latestEvent,
      pendingDecisionRequests: this.cribbageGame.getPendingDecisionRequests(),
    };
    this.cribbageGame.emit('gameSnapshot', snapshot);
  }

  /**
   * Create a decision request without emitting a snapshot
   * Used for batching multiple requests before emitting
   * @param playerId - ID of the player we're waiting on
   * @param decisionType - Type of decision required
   * @param requestData - Context-specific data for the request
   * @returns The created DecisionRequest
   */
  private createDecisionRequest(
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
    return request;
  }

  /**
   * Request a decision from a player
   * Creates a DecisionRequest and adds it to pending requests
   * Emits a GameSnapshot immediately so agents can see the new request
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
    const request = this.createDecisionRequest(playerId, decisionType, requestData);
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
        const playerName = this.cribbageGame.getGameState().players.find(p => p.id === request.playerId)?.name || request.playerId;
        const moveStartTime = Date.now();
        const card = await agent.makeMove(redactedSnapshot, request.playerId);
        const moveEndTime = Date.now();
        logger.logAgentDuration('MOVE', playerName, moveEndTime - moveStartTime);
        this.cribbageGame.removeDecisionRequest(request.requestId);
        return card;
      }

      case AgentDecisionType.DISCARD: {
        const data = request.requestData as DiscardRequestData;
        const playerName = this.cribbageGame.getGameState().players.find(p => p.id === request.playerId)?.name || request.playerId;
        const discardStartTime = Date.now();
        const discards = await agent.discard(
          redactedSnapshot,
          request.playerId,
          data.numberOfCardsToDiscard
        );
        const discardEndTime = Date.now();
        logger.logAgentDuration('DISCARD', playerName, discardEndTime - discardStartTime);
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

      case AgentDecisionType.SELECT_DEALER_CARD: {
        if (agent.selectDealerCard) {
          const selectData = request.requestData as SelectDealerCardRequestData;
          const cardIndex = await agent.selectDealerCard(
            redactedSnapshot,
            request.playerId,
            selectData.maxIndex
          );
          this.cribbageGame.removeDecisionRequest(request.requestId);
          this.cribbageGame.selectDealerCard(request.playerId, cardIndex);
          return cardIndex;
        }
        break;
      }

      case AgentDecisionType.READY_FOR_COUNTING: {
        const ackStartTime = Date.now();
        console.log(`[TIMING] READY_FOR_COUNTING: Calling agent.acknowledgeReadyForCounting for player ${request.playerId} at ${ackStartTime}ms`);
        
        if (agent.acknowledgeReadyForCounting) {
          const beforeAgentCall = Date.now();
          await agent.acknowledgeReadyForCounting(
            redactedSnapshot,
            request.playerId
          );
          const afterAgentCall = Date.now();
          console.log(`[TIMING] READY_FOR_COUNTING: agent.acknowledgeReadyForCounting returned for player ${request.playerId} at ${afterAgentCall}ms (took ${afterAgentCall - beforeAgentCall}ms)`);
        } else {
          console.log(`[TIMING] READY_FOR_COUNTING: agent.acknowledgeReadyForCounting not available for player ${request.playerId}`);
        }
        
        const removeStartTime = Date.now();
        this.cribbageGame.removeDecisionRequest(request.requestId);
        const removeEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_COUNTING: Removed decision request for player ${request.playerId} at ${removeEndTime}ms (took ${removeEndTime - removeStartTime}ms)`);
        
        // Emit GameSnapshot immediately so app sees the acknowledgment
        const emitStartTime = Date.now();
        this.emitAcknowledgmentSnapshot();
        const emitEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_COUNTING: Emitted acknowledgment snapshot for player ${request.playerId} at ${emitEndTime}ms (took ${emitEndTime - emitStartTime}ms, total from start: ${emitEndTime - ackStartTime}ms)`);
        return;
      }

      case AgentDecisionType.READY_FOR_GAME_START: {
        const ackStartTime = Date.now();
        console.log(`[TIMING] READY_FOR_GAME_START: Calling agent.acknowledgeReadyForGameStart for player ${request.playerId} at ${ackStartTime}ms`);
        
        if (agent.acknowledgeReadyForGameStart) {
          const beforeAgentCall = Date.now();
          await agent.acknowledgeReadyForGameStart(
            redactedSnapshot,
            request.playerId
          );
          const afterAgentCall = Date.now();
          console.log(`[TIMING] READY_FOR_GAME_START: agent.acknowledgeReadyForGameStart returned for player ${request.playerId} at ${afterAgentCall}ms (took ${afterAgentCall - beforeAgentCall}ms)`);
        } else {
          console.log(`[TIMING] READY_FOR_GAME_START: agent.acknowledgeReadyForGameStart not available for player ${request.playerId}`);
        }
        
        const removeStartTime = Date.now();
        this.cribbageGame.removeDecisionRequest(request.requestId);
        const removeEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_GAME_START: Removed decision request for player ${request.playerId} at ${removeEndTime}ms (took ${removeEndTime - removeStartTime}ms)`);
        
        // Emit GameSnapshot immediately so app sees the acknowledgment
        const emitStartTime = Date.now();
        this.emitAcknowledgmentSnapshot();
        const emitEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_GAME_START: Emitted acknowledgment snapshot for player ${request.playerId} at ${emitEndTime}ms (took ${emitEndTime - emitStartTime}ms, total from start: ${emitEndTime - ackStartTime}ms)`);
        return;
      }

      case AgentDecisionType.READY_FOR_NEXT_ROUND: {
        const ackStartTime = Date.now();
        console.log(`[TIMING] READY_FOR_NEXT_ROUND: Calling agent.acknowledgeReadyForNextRound for player ${request.playerId} at ${ackStartTime}ms`);
        
        if (agent.acknowledgeReadyForNextRound) {
          const beforeAgentCall = Date.now();
          await agent.acknowledgeReadyForNextRound(
            redactedSnapshot,
            request.playerId
          );
          const afterAgentCall = Date.now();
          console.log(`[TIMING] READY_FOR_NEXT_ROUND: agent.acknowledgeReadyForNextRound returned for player ${request.playerId} at ${afterAgentCall}ms (took ${afterAgentCall - beforeAgentCall}ms)`);
        } else {
          console.log(`[TIMING] READY_FOR_NEXT_ROUND: agent.acknowledgeReadyForNextRound not available for player ${request.playerId}`);
        }
        
        const removeStartTime = Date.now();
        this.cribbageGame.removeDecisionRequest(request.requestId);
        const removeEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_NEXT_ROUND: Removed decision request for player ${request.playerId} at ${removeEndTime}ms (took ${removeEndTime - removeStartTime}ms)`);
        
        // Emit GameSnapshot immediately so app sees the acknowledgment
        const emitStartTime = Date.now();
        this.emitAcknowledgmentSnapshot();
        const emitEndTime = Date.now();
        console.log(`[TIMING] READY_FOR_NEXT_ROUND: Emitted acknowledgment snapshot for player ${request.playerId} at ${emitEndTime}ms (took ${emitEndTime - emitStartTime}ms, total from start: ${emitEndTime - ackStartTime}ms)`);
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
    // Get discard count based on player count configuration
    const config = getPlayerCountConfig(gameState.players.length);
    const numberOfCardsToDiscard = config.discardPerPlayer;

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

    // Wait for all discards in parallel, but apply each discard immediately when it resolves
    console.log(`[doCribPhase] Requesting discards from ${discardRequests.length} players in parallel`);
    const discardPromises = discardRequests.map(async (request, index) => {
      console.log(`[doCribPhase] Starting waitForDecision for player ${request.playerId}`);
      const discards = await this.waitForDecision(request);
      // Apply discard immediately when it resolves (don't wait for all)
      const player = gameState.players[index];
      console.log(`[doCribPhase] Applying discard immediately for player ${player.id}, got ${discards.length} cards`);
      this.cribbageGame.discardToCrib(player.id, discards);
      return discards;
    });
    console.log(`[doCribPhase] All promises created, waiting for Promise.all()...`);
    const allDiscards = await Promise.all(discardPromises);
    console.log(`[doCribPhase] All discards received:`, allDiscards.map((d, i) => ({ player: discardRequests[i].playerId, count: d.length })));

    this.cribbageGame.completeCribPhase();
  }

  /**
   * Wait for all players to acknowledge (parallel, blocking)
   * @param decisionType - The acknowledgment type
   * @param message - User-friendly message
   */
  private async waitForAllPlayersReady(
    decisionType:
      | AgentDecisionType.READY_FOR_GAME_START
      | AgentDecisionType.READY_FOR_COUNTING
      | AgentDecisionType.READY_FOR_NEXT_ROUND,
    message: string
  ): Promise<void> {
    const startTime = Date.now();
    console.log(`[TIMING] waitForAllPlayersReady START at ${startTime}ms for ${decisionType}`);
    
    // Request acknowledgments from ALL players in parallel
    // Create all requests first without emitting snapshots to avoid showing partial counts
    const acknowledgeRequests: DecisionRequest[] = [];
    const gameState = this.cribbageGame.getGameState();

    for (const player of gameState.players) {
      const requestStartTime = Date.now();
      const request = this.createDecisionRequest(player.id, decisionType, {
        message,
      });
      console.log(`[TIMING] Created request for player ${player.id} at ${requestStartTime}ms (${requestStartTime - startTime}ms after start)`);
      acknowledgeRequests.push(request);
    }

    // Now emit a single snapshot with all requests so UI shows correct count from the start
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
    console.log(`[TIMING] Emitted snapshot with ${acknowledgeRequests.length} acknowledgment requests`);

    // Wait for all acknowledgments in parallel
    // Each player can acknowledge independently
    const acknowledgePromises = acknowledgeRequests.map(request => {
      const promiseStartTime = Date.now();
      console.log(`[TIMING] Starting waitForDecision promise for player ${request.playerId} at ${promiseStartTime}ms (${promiseStartTime - startTime}ms after start)`);
      return this.waitForDecision(request).then(result => {
        const promiseEndTime = Date.now();
        console.log(`[TIMING] waitForDecision promise resolved for player ${request.playerId} at ${promiseEndTime}ms (took ${promiseEndTime - promiseStartTime}ms)`);
        return result;
      });
    });

    // Wait for all to complete (blocking)
    await Promise.all(acknowledgePromises);

    const endTime = Date.now();
    console.log(`[TIMING] waitForAllPlayersReady COMPLETE at ${endTime}ms (total: ${endTime - startTime}ms)`);
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
    // Feature flag: can be enabled via ENABLE_READY_FOR_COUNTING=true env var
    if (ENABLE_READY_FOR_COUNTING) {
      await this.waitForAllPlayersReady(
        AgentDecisionType.READY_FOR_COUNTING,
        'Ready for counting'
      );
    } else {
      console.log('[FEATURE FLAG] READY_FOR_COUNTING is disabled, skipping acknowledgment request');
    }

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
   * Handle dealer selection phase (only for first round)
   * All players select cards from the deck, lowest card becomes dealer
   */
  private async doDealerSelection(): Promise<void> {
    const gameState = this.cribbageGame.getGameState();
    
    if (gameState.currentPhase !== Phase.DEALER_SELECTION) {
      // Already determined dealer, skip
      return;
    }

    console.log('Starting dealer selection phase...');

    // Request dealer card selection from ALL players in parallel
    const selectionRequests: DecisionRequest[] = [];
    const deckSize = gameState.deck.length;

    // Create all requests first without emitting snapshots
    for (const player of gameState.players) {
      const request = this.createDecisionRequest(
        player.id,
        AgentDecisionType.SELECT_DEALER_CARD,
        {
          maxIndex: deckSize - 1,
          deckSize,
        }
      );
      selectionRequests.push(request);
    }

    // Emit a single snapshot with all requests
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
    console.log(`Emitted snapshot with ${selectionRequests.length} dealer selection requests`);

    // Wait for all selections in parallel
    const selectionPromises = selectionRequests.map(request =>
      this.waitForDecision(request)
    );

    await Promise.all(selectionPromises);

    // Dealer should now be determined (handled in selectDealerCard)
    const dealer = this.cribbageGame.getGameState().players.find(p => p.isDealer);
    if (!dealer) {
      throw new Error('Dealer was not determined after dealer selection phase.');
    }
    console.log(`Dealer selection complete. Dealer: ${dealer.name}`);

    // Request acknowledgment from all players before starting the game
    // This gives players time to see the dealer selection results
    await this.waitForAllPlayersReady(
      AgentDecisionType.READY_FOR_GAME_START,
      'Ready to start game'
    );

    // Clear dealer selection cards now that acknowledgment is complete
    this.cribbageGame.clearDealerSelectionCards();
  }

  /**
   * Runs the entire game loop until a player wins
   * @returns the ID of the winning player
   */
  public async playGame(): Promise<string> {
    // Handle dealer selection before first round
    await this.doDealerSelection();

    let winner: string | null = null;

    while (!winner) {
      winner = await this.doRound();
    }

    this.cribbageGame.endGame(winner);

    return Promise.resolve(winner);
  }
}
