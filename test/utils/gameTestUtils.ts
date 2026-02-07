import { GameSession, GameSessionStatus } from '../../src/gameplay/GameSession';
import { Phase, PlayerIdAndName, GameAgent, ActionType, GameSnapshot } from '../../src/types';
import { RandomAgent } from '../../src/agents/RandomAgent';
import { HeuristicSimpleAgent } from '../../src/agents/HeuristicSimpleAgent';
import { ExhaustiveSimpleAgent } from '../../src/agents/ExhaustiveSimpleAgent';

/**
 * Bot difficulty levels
 */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Creates a bot agent based on difficulty level
 * @param difficulty - The difficulty level ('easy' = RandomAgent, 'medium' = HeuristicSimpleAgent, 'hard' = ExhaustiveSimpleAgent)
 * @param playerId - The player ID for the agent
 * @returns A configured GameAgent instance
 */
function createBotAgent(difficulty: BotDifficulty, playerId: string): GameAgent {
  let agent: GameAgent;
  
  switch (difficulty) {
    case 'easy':
      agent = new RandomAgent();
      break;
    case 'medium':
      agent = new HeuristicSimpleAgent();
      break;
    case 'hard':
      agent = new ExhaustiveSimpleAgent();
      break;
    default:
      agent = new RandomAgent();
  }
  
  agent.playerId = playerId;
  return agent;
}

/**
 * Creates a test session with the specified number of players
 * @param playerCount - Number of players (2, 3, or 4)
 * @param config - Optional configuration (currently unused, reserved for future use)
 * @returns A new GameSession instance
 */
export function createTestSession(
  playerCount: number,
  config?: unknown
): GameSession {
  if (playerCount < 2 || playerCount > 4) {
    throw new Error(`Invalid player count: ${playerCount}. Must be 2, 3, or 4.`);
  }
  
  const players: PlayerIdAndName[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `player-${i + 1}`,
    name: `Player ${i + 1}`,
  }));
  
  return GameSession.create(players);
}

/**
 * Fills a session with bot agents for all players
 * @param session - The GameSession to fill
 * @param difficulty - Bot difficulty level (default: 'easy')
 */
function fillSessionWithBots(session: GameSession, difficulty: BotDifficulty = 'easy'): void {
  const players = session.getGameState().players;
  
  for (const player of players) {
    const agent = createBotAgent(difficulty, player.id);
    session.addAgent(player.id, agent);
  }
}

/**
 * Plays a complete game with bot agents
 * @param playerCount - Number of players (2, 3, or 4)
 * @param difficulty - Bot difficulty level (default: 'easy')
 * @returns Promise resolving to winner ID and the completed session
 */
export async function playCompleteGame(
  playerCount: 2 | 3 | 4,
  difficulty: BotDifficulty = 'easy'
): Promise<{ winner: string; session: GameSession }> {
  const session = createTestSession(playerCount);
  fillSessionWithBots(session, difficulty);
  
  const winner = await session.start();
  
  return { winner, session };
}

/**
 * Plays a game session until it reaches a specific phase
 * Note: The game will continue running after the target phase is reached.
 * This function only waits for the phase to be reached, it does not pause the game.
 * @param session - The GameSession to play
 * @param targetPhase - The phase to stop at
 * @returns Promise that resolves when the target phase is reached
 */
export async function playUntilPhase(
  session: GameSession,
  targetPhase: Phase
): Promise<void> {
  if (session.getStatus() !== GameSessionStatus.CREATED) {
    throw new Error(`Cannot playUntilPhase: session must be in CREATED status, but is ${session.getStatus()}`);
  }
  
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    let gameStartPromise: Promise<string> | null = null;
    
    const checkPhase = (gameState: { currentPhase: Phase }) => {
      if (resolved) return;
      
      if (gameState.currentPhase === targetPhase) {
        resolved = true;
        session.off('gameStateChange', checkPhase);
        session.off('gameSnapshot', checkSnapshot);
        resolve();
      }
    };
    
    const checkSnapshot = (snapshot: GameSnapshot) => {
      if (resolved) return;
      
      if (snapshot.gameState.currentPhase === targetPhase) {
        resolved = true;
        session.off('gameStateChange', checkPhase);
        session.off('gameSnapshot', checkSnapshot);
        resolve();
      }
    };
    
    // Check current phase first
    const currentPhase = session.getGameState().currentPhase;
    if (currentPhase === targetPhase) {
      resolve();
      return;
    }
    
    // Set up listeners BEFORE starting the game to avoid race conditions
    session.on('gameStateChange', checkPhase);
    session.on('gameSnapshot', checkSnapshot);
    
    // Start the game (it will continue running after target phase is reached)
    gameStartPromise = session.start();
    gameStartPromise.catch((error) => {
      if (resolved) return; // Already resolved, ignore error
      
      // If game completes before reaching target phase, check if we're at target phase
      session.off('gameStateChange', checkPhase);
      session.off('gameSnapshot', checkSnapshot);
      const finalPhase = session.getGameState().currentPhase;
      if (finalPhase === targetPhase) {
        resolved = true;
        resolve();
      } else {
        // Game completed or errored - check if it's a completion (not an error)
        if (session.getStatus() === GameSessionStatus.ENDED && finalPhase === Phase.END) {
          reject(new Error(`Game completed at phase ${finalPhase} before reaching target phase ${targetPhase}`));
        } else {
          reject(new Error(`Game ended at phase ${finalPhase} before reaching target phase ${targetPhase}: ${error.message}`));
        }
      }
    });
  });
}

/**
 * Asserts that a game session has ended validly
 * Validates:
 * - Session status is ENDED
 * - Winner is one of the players
 * - Winner has score >= 121
 * - Game state is in END phase
 * @param session - The GameSession to validate
 * @throws Error if validation fails
 */
export function assertValidGameEnd(session: GameSession): void {
  const status = session.getStatus();
  if (status !== GameSessionStatus.ENDED) {
    throw new Error(`Expected session status to be ENDED, but got ${status}`);
  }
  
  const winnerId = session.getWinnerId();
  if (!winnerId) {
    throw new Error('Expected winner ID to be set, but got null');
  }
  
  const gameState = session.getGameState();
  const winner = gameState.players.find(p => p.id === winnerId);
  
  if (!winner) {
    throw new Error(`Winner ID ${winnerId} not found in players`);
  }
  
  if (winner.score < 121) {
    throw new Error(`Expected winner score to be >= 121, but got ${winner.score}`);
  }
  
  if (gameState.currentPhase !== Phase.END) {
    throw new Error(`Expected game phase to be END, but got ${gameState.currentPhase}`);
  }
  
  // Additional validation: ensure snapshot history exists
  const snapshotHistory = session.getSnapshotHistory();
  if (snapshotHistory.length === 0) {
    throw new Error('Expected snapshot history to be non-empty');
  }
  
  // Validate final snapshot has WIN action
  const lastSnapshot = snapshotHistory[snapshotHistory.length - 1];
  if (lastSnapshot.gameEvent.actionType !== ActionType.WIN) {
    throw new Error(`Expected final action type to be WIN, but got ${lastSnapshot.gameEvent.actionType}`);
  }
}
