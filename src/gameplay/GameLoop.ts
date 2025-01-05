import { randomInt } from 'crypto';
import { CribbageGame } from '../core/CribbageGame';
import { Player, GameAgent, ActionType } from '../types';

export class GameLoop {
  public game: CribbageGame;
  private agents: Record<string, GameAgent> = {};

  constructor(playerNames: string[]) {
    this.game = new CribbageGame(playerNames);
  }

  public addAgent(playerId: string, agent: GameAgent): void {
    this.agents[playerId] = agent;
  }

  public async doRound(): Promise<string | null> {
    this.game.deal();

    // Crib phase: Agents discard to crib
    for (const player of this.game.getGameState().players) {
      const agent = this.agents[player.id];
      if (!agent) throw new Error(`No agent for player ${player.id}`);

      const discards = await agent.discard(this.game.getGameState(), player.id);
      this.game.discardToCrib(player.id, discards);
    }

    this.game.completeCribPhase();

    // Cutting phase: Agents cut the deck
    const dealerIndex = this.game
      .getGameState()
      .players.findIndex(player => player.isDealer);
    const behindDealerIndex =
      (dealerIndex - 1 + this.game.getGameState().players.length) %
      this.game.getGameState().players.length;
    const behindDealer = this.game.getGameState().players[behindDealerIndex];
    this.game.cutDeck(
      behindDealer.id,
      randomInt(0, this.game.getGameState().deck.length)
    );

    // SCORING PHASE
    // Loop through each player and score their hand, starting with player after dealer and ending with dealer
    // Dealer also scores their crib after scoring their hand
    const afterDealerIndex =
      (dealerIndex + 1) % this.game.getGameState().players.length;
    for (let n = 0; n < this.game.getGameState().players.length; n++) {
      const i =
        (afterDealerIndex + n) % this.game.getGameState().players.length;
      const player = this.game.getGameState().players[i];
      const agent = this.agents[player.id];
      if (!agent) throw new Error(`No agent for player ${player.id}`);

      this.game.scoreHand(player.id);

      if (player.score > 120) {
        return player.id;
      }

      if (player.isDealer) {
        this.game.scoreCrib(player.id);
      }

      if (player.score > 120) {
        return player.id;
      }
    }

    // Cleanup and Reset state and rotate dealer
    this.game.endRound();

    return null;
  }

  public async start(): Promise<string> {
    // Pegging phase
    let winner: string | null = null;

    while (!winner) {
      winner = await this.doRound();
      if (!winner) {
        // console.log(
        //   `Scores: ${this.game
        //     .getGameState()
        //     .players.map(p => p.score)
        //     .join(', ')}`
        // );
      }
    }

    return `Winner: ${winner}`;
  }
}
