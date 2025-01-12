import { randomInt } from 'crypto';
import { CribbageGame } from '../core/CribbageGame';
import { Player, GameAgent, ActionType } from '../types';
import { parseCard, suitToEmoji } from '../core/scoring';

export class GameLoop {
  public game: CribbageGame;
  private agents: Record<string, GameAgent> = {};

  constructor(playerNames: string[]) {
    this.game = new CribbageGame(playerNames);
  }

  public addAgent(playerId: string, agent: GameAgent): void {
    this.agents[playerId] = agent;
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

    let currentPlayer = this.game.getFollowingPlayerId(this.game.getDealerId());
    const playersDone: string[] = []; // list of player ids who have no cards left to play
    let roundOverLastPlayer: string | null = null;
    while (playersDone.length < this.game.getGameState().players.length) {
      // if the current player has no cards left to play, move on to the next player
      if (playersDone.includes(currentPlayer)) {
        currentPlayer = this.game.getFollowingPlayerId(currentPlayer);
        continue;
      }

      // if the current player has already said "Go", move on to the next player
      if (this.game.getGameState().peggingGoPlayers.includes(currentPlayer)) {
        currentPlayer = this.game.getFollowingPlayerId(currentPlayer);
        continue;
      }

      const agent = this.agents[currentPlayer];
      if (!agent) throw new Error(`No agent for player ${currentPlayer}`);

      // get the card the agent wants to play
      const card = await agent.makeMove(
        this.game.getGameState(),
        currentPlayer
      );
      roundOverLastPlayer = this.game.playCard(currentPlayer, card);
      const parsedStack = this.game.getGameState().peggingStack.map(parseCard);
      console.log(
        `Full pegging stack: ${parsedStack
          .map(card => `${card.runValue}${suitToEmoji(card.suit)}`)
          .join(', ')}`
      );
      // if current player pegged out, return their ID as winner of game
      if (this.game.getPlayer(currentPlayer).score > 120) {
        return Promise.resolve(currentPlayer);
      }

      // // if player is out of cards now, add them to the list of players done
      // if (this.game.getPlayer(currentPlayer).peggingHand.length === 0) {
      //   playersDone.push(currentPlayer);
      // }

      // if the round is over, start next round with the person following the last person to play a card
      if (roundOverLastPlayer) {
        currentPlayer = this.game.getFollowingPlayerId(roundOverLastPlayer);
        // update the list of players done - check all players to see if they are out of cards
        for (const player of this.game.getGameState().players) {
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
        currentPlayer = this.game.getFollowingPlayerId(currentPlayer);
      }
    }
    // if all players are out of cards, pegging is over
    this.game.endPegging();
    console.log('PEGGING OVER\n');

    // if no one has pegged out, return null to indicate no winner
    return Promise.resolve(null);
  }

  private async doRound(): Promise<string | null> {
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

    // Pegging phase: Agents play cards until no more cards can be played
    const peggingWinner = await this.doPegging();
    if (peggingWinner) {
      console.log(`PLAYER ${peggingWinner} WINS BY PEGGING!!!`);
      return peggingWinner;
    }

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
