import { GameLoop } from './GameLoop';
import { CribbageGame, SerializedCribbageGameState } from '../core/CribbageGame';
import {
  PlayerIdAndName,
  GameState,
  GameSnapshot,
  GameAgent,
} from '../types';
import EventEmitter from 'eventemitter3';

/**
 * Status of a game session
 */
export enum GameSessionStatus {
  CREATED = 'CREATED',
  STARTING = 'STARTING',
  IN_PROGRESS = 'IN_PROGRESS',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

/**
 * GameSession wraps CribbageGame and GameLoop to provide a clean lifecycle API.
 * This abstraction allows for controlled game execution and decision handling.
 */
export class GameSession extends EventEmitter {
  private gameLoop: GameLoop;
  private status: GameSessionStatus = GameSessionStatus.CREATED;
  private winnerId: string | null = null;

  private constructor(playersInfo: PlayerIdAndName[]) {
    super();
    this.gameLoop = new GameLoop(playersInfo);
    this.setupEventForwarding();
  }

  /**
   * Create a new game session
   * @param playersInfo - Array of player information
   * @returns A new GameSession instance
   */
  public static create(playersInfo: PlayerIdAndName[]): GameSession {
    return new GameSession(playersInfo);
  }

  /**
   * Set up event forwarding from GameLoop to GameSession
   */
  private setupEventForwarding(): void {
    this.gameLoop.on('gameStateChange', (gameState: GameState) => {
      this.emit('gameStateChange', gameState);
    });

    this.gameLoop.on('gameEvent', gameEvent => {
      this.emit('gameEvent', gameEvent);
    });

    this.gameLoop.on('gameSnapshot', (snapshot: GameSnapshot) => {
      this.emit('gameSnapshot', snapshot);
    });
  }

  /**
   * Add an agent for a player
   * @param playerId - ID of the player
   * @param agent - The agent to use for this player
   */
  public addAgent(playerId: string, agent: GameAgent): void {
    this.gameLoop.addAgent(playerId, agent);
  }

  /**
   * Start the game session
   * Runs the game loop until completion or cancellation
   * @returns Promise resolving to the winner's player ID
   */
  public async start(): Promise<string> {
    if (this.status !== GameSessionStatus.CREATED) {
      throw new Error(
        `Cannot start game session in status ${this.status}. Expected CREATED.`
      );
    }

    this.status = GameSessionStatus.STARTING;
    this.emit('statusChange', this.status);

    try {
      this.status = GameSessionStatus.IN_PROGRESS;
      this.emit('statusChange', this.status);

      const winner = await this.gameLoop.playGame();
      this.winnerId = winner;
      this.status = GameSessionStatus.ENDED;
      this.emit('statusChange', this.status);
      this.emit('gameEnded', winner);

      return winner;
    } catch (error) {
      // Check if cancelled (status could have changed during async operation)
      // cancel() can be called asynchronously, so we need to check the actual status
      if (this.getStatus() === GameSessionStatus.CANCELLED) {
        throw error;
      }
      // If not cancelled, mark as ended due to error
      this.status = GameSessionStatus.ENDED;
      this.emit('statusChange', this.status);
      throw error;
    }
  }

  /**
   * Cancel the game session
   * Stops all pending operations and marks the session as cancelled
   */
  public cancel(): void {
    if (
      this.status === GameSessionStatus.ENDED ||
      this.status === GameSessionStatus.CANCELLED
    ) {
      return;
    }

    this.status = GameSessionStatus.CANCELLED;
    this.gameLoop.cancel();
    this.emit('statusChange', this.status);
    this.emit('cancelled');
  }

  /**
   * End the game session
   * Marks the session as ended (called automatically when game completes)
   */
  public end(): void {
    if (this.status === GameSessionStatus.ENDED) {
      return;
    }

    if (this.status === GameSessionStatus.CANCELLED) {
      throw new Error('Cannot end a cancelled session');
    }

    this.status = GameSessionStatus.ENDED;
    this.emit('statusChange', this.status);
  }

  /**
   * Get the current game state
   * @returns The current GameState
   */
  public getGameState(): GameState {
    return this.gameLoop.cribbageGame.getGameState();
  }

  /**
   * Get the current game snapshot
   * @returns The most recent GameSnapshot
   */
  public getCurrentSnapshot(): GameSnapshot | null {
    const history = this.gameLoop.cribbageGame.getGameSnapshotHistory();
    return history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get the game snapshot history
   * @returns Array of all GameSnapshots
   */
  public getSnapshotHistory(): GameSnapshot[] {
    return this.gameLoop.cribbageGame.getGameSnapshotHistory();
  }

  /**
   * Get the current status
   * @returns Current GameSessionStatus
   */
  public getStatus(): GameSessionStatus {
    return this.status;
  }

  /**
   * Get the winner ID (if game has ended)
   * @returns Winner's player ID or null if not ended
   */
  public getWinnerId(): string | null {
    return this.winnerId;
  }

  /**
   * Get the underlying CribbageGame instance
   * @returns The CribbageGame instance
   */
  public getCribbageGame(): CribbageGame {
    return this.gameLoop.cribbageGame;
  }

  /**
   * Get the underlying GameLoop instance
   * @returns The GameLoop instance
   */
  public getGameLoop(): GameLoop {
    return this.gameLoop;
  }

  /**
   * Serialize the game session to JSON-compatible format
   * Dates are serialized as ISO strings for JSON compatibility
   * Agents are NOT serialized and must be reattached after deserialization
   * @returns Serialized game session data
   */
  public toJSON(): SerializedGameSession {
    const gameState = this.gameLoop.cribbageGame.getGameState();
    const playersInfo: PlayerIdAndName[] = gameState.players.map(p => ({
      id: p.id,
      name: p.name,
    }));

    return {
      version: 1,
      players: playersInfo,
      status: this.status,
      winnerId: this.winnerId,
      gameState: this.gameLoop.cribbageGame.serialize(),
    };
  }

  /**
   * Restore a game session from serialized JSON data
   * Agents are NOT restored and must be reattached via addAgent()
   * @param data - Serialized game session data
   * @returns Restored GameSession instance
   */
  public static fromJSON(data: SerializedGameSession): GameSession {
    const session = new GameSession(data.players);

    // Restore status and winner
    session.status = data.status;
    session.winnerId = data.winnerId;

    // Restore game state using CribbageGame's restoreState method
    session.gameLoop.cribbageGame.restoreState(data.gameState);

    return session;
  }
}

/**
 * Serialized format for GameSession
 * Dates are serialized as ISO strings for JSON compatibility
 * Agents are NOT included and must be reattached after deserialization
 */
export interface SerializedGameSession {
  version: number;
  players: PlayerIdAndName[];
  status: GameSessionStatus;
  winnerId: string | null;
  gameState: SerializedCribbageGameState;
}
