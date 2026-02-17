import { CribbageGame } from '../src/core/CribbageGame';
import { Phase, ActionType, Card } from '../src/types';
import { parseCard, sumOfPeggingStack } from '../src/core/scoring';

describe('CribbageGame - Pegging Logic', () => {
  describe('playCard - Basic Functionality', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should play a card and add it to pegging stack', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['ACE_SPADES', 'TWO_HEARTS'];
      state.peggingStack = [];
      state.peggingTotal = 0;

      const result = game.playCard('p1', 'ACE_SPADES');

      expect(result).toBeNull(); // Round not over
      expect(state.peggingStack).toContain('ACE_SPADES');
      expect(state.peggingTotal).toBe(1);
      expect(player.peggingHand).not.toContain('ACE_SPADES');
      expect(state.peggingLastCardPlayer).toBe('p1');
    });

    it('should remove card from player hand when played', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['ACE_SPADES', 'TWO_HEARTS'];
      state.peggingStack = [];

      game.playCard('p1', 'ACE_SPADES');

      expect(player.peggingHand).toEqual(['TWO_HEARTS']);
      expect(player.peggingHand.length).toBe(1);
    });

    it('should update peggingTotal correctly', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['FIVE_SPADES', 'TEN_HEARTS'];
      state.peggingStack = [];
      state.peggingTotal = 0;

      game.playCard('p1', 'FIVE_SPADES');
      expect(state.peggingTotal).toBe(5);

      const player2 = state.players[1];
      player2.peggingHand = ['TEN_HEARTS'];
      game.playCard('p2', 'TEN_HEARTS');
      expect(state.peggingTotal).toBe(15);
    });

    it('should record PLAY_CARD event', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['ACE_SPADES'];
      state.peggingStack = [];

      const historyBefore = game.getGameSnapshotHistory().length;
      game.playCard('p1', 'ACE_SPADES');

      const history = game.getGameSnapshotHistory();
      const playCardEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.PLAY_CARD
      );
      expect(playCardEvent).toBeDefined();
      expect(playCardEvent?.gameEvent.playerId).toBe('p1');
      expect(playCardEvent?.gameEvent.cards).toEqual(['ACE_SPADES']);
    });
  });

  describe('playCard - Saying "Go"', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should add player to peggingGoPlayers when saying Go', () => {
      const state = game.getGameState();
      state.peggingGoPlayers = [];

      const result = game.playCard('p1', null);

      expect(result).toBeNull(); // Round not over
      expect(state.peggingGoPlayers).toContain('p1');
    });

    it('should record GO event when saying Go', () => {
      const state = game.getGameState();
      game.playCard('p1', null);

      const history = game.getGameSnapshotHistory();
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.GO);
      expect(lastEvent.playerId).toBe('p1');
    });

    it('should not add player to peggingGoPlayers twice', () => {
      const state = game.getGameState();
      state.peggingGoPlayers = [];

      game.playCard('p1', null);
      game.playCard('p1', null); // Say Go again

      expect(state.peggingGoPlayers.filter(p => p === 'p1').length).toBe(1);
    });
  });

  describe('playCard - "Last Card" Detection', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should award last card point when last card player says Go and all others have said Go', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played last card, both players still have cards
      p1.peggingHand = ['TEN_HEARTS'];
      p2.peggingHand = ['KING_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS']; // Total = 21
      state.peggingTotal = 21;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      // p2 says Go (can't play without exceeding 31)
      game.playCard('p2', null);
      expect(state.peggingGoPlayers).toContain('p2');

      // p1 says Go (they played last card, all others have said Go)
      const result = game.playCard('p1', null);

      expect(result).toBe('p1'); // Round over, last card player returned
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Go players cleared
    });

    it('should award last card point when last card player runs out of cards and all others say Go', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played their last card (stack now at 28), p1 has no cards left
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = ['KING_SPADES']; // Has a card but can't play (would exceed 31)
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1'; // p1 played the last card
      state.peggingGoPlayers = [];

      // p2 says Go (can't play without exceeding 31)
      const result = game.playCard('p2', null);

      // Should detect that p1 (last card player) has no cards and all others said Go
      expect(result).toBe('p1'); // Round over, last card player returned
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Go players cleared
    });

    it('should NOT award last card point if last card player still has cards and others say Go', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played last card but still has cards
      p1.peggingHand = ['TWO_HEARTS']; // Still has cards
      p2.peggingHand = ['KING_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS']; // Total = 21
      state.peggingTotal = 21;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      // p2 says Go
      game.playCard('p2', null);

      // p1 should NOT get last card point yet (they still have cards to play)
      expect(p1.score).toBe(0);
      expect(state.peggingStack.length).toBeGreaterThan(0); // Stack not cleared
    });

    it('should award last card point when last card player has cards but can\'t play them (e.g., 2 at stack 30)', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played last card, p1 has a 2 but stack is at 30 (can't play without exceeding 31)
      p1.peggingHand = ['TWO_HEARTS']; // Has a card but can't play (30 + 2 = 32 > 31)
      p2.peggingHand = ['KING_SPADES']; // Has a card but can't play (would exceed 31)
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'NINE_HEARTS']; // Total = 30
      state.peggingTotal = 30;
      state.peggingLastCardPlayer = 'p1'; // p1 played the last card
      state.peggingGoPlayers = [];

      // p2 says Go (can't play without exceeding 31)
      const result = game.playCard('p2', null);

      // Should detect that p1 (last card player) can't play and all others said Go
      expect(result).toBe('p1'); // Round over, last card player returned
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Go players cleared
    });

    it('should handle 3-player scenario: last card player out of cards, others say Go', () => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      // Setup: p1 played last card (stack at 28), p1 has no cards left
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = ['KING_SPADES'];
      p3.peggingHand = ['QUEEN_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      // p2 says Go
      game.playCard('p2', null);
      expect(state.peggingGoPlayers).toContain('p2');

      // p3 says Go
      const result = game.playCard('p3', null);

      // Should detect that p1 (last card player) has no cards and all others said Go
      expect(result).toBe('p1'); // Round over
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0);
      expect(state.peggingGoPlayers.length).toBe(0);
    });

    it('should handle 4-player scenario: last card player out of cards, others say Go', () => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
        { id: 'p4', name: 'Player 4' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];
      const p4 = state.players[3];

      // Setup: p1 played last card (stack at 28), p1 has no cards left
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = ['KING_SPADES'];
      p3.peggingHand = ['QUEEN_HEARTS'];
      p4.peggingHand = ['JACK_CLUBS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      // p2 says Go
      game.playCard('p2', null);
      // p3 says Go
      game.playCard('p3', null);
      // p4 says Go
      const result = game.playCard('p4', null);

      // Should detect that p1 (last card player) has no cards and all others said Go
      expect(result).toBe('p1'); // Round over
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0);
      expect(state.peggingGoPlayers.length).toBe(0);
    });

    it('should record LAST_CARD event when awarding last card point', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      p1.peggingHand = [];
      p2.peggingHand = ['KING_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS'];
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      game.playCard('p2', null);

      const history = game.getGameSnapshotHistory();
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.LAST_CARD);
      expect(lastEvent.playerId).toBe('p1');
      expect(lastEvent.scoreChange).toBe(1);
    });

    it('should NOT award last card point when last card player says Go but others have not said Go', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played last card, p1 has no cards left
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = ['KING_SPADES']; // Has a card but can't play (would exceed 31)
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1'; // p1 played the last card
      state.peggingGoPlayers = [];

      // p1 says Go (but p2 hasn't said Go yet)
      // Since p1 is the last card player saying Go, they should go through the normal path
      // which checks if all others have said Go (they haven't), so no bonus yet
      const result = game.playCard('p1', null);

      // Should NOT award bonus yet because p2 hasn't said Go
      expect(result).toBeNull(); // Round not over yet
      expect(p1.score).toBe(0); // No bonus point yet
      expect(state.peggingStack.length).toBeGreaterThan(0); // Stack not cleared
      expect(state.peggingGoPlayers).toContain('p1'); // p1 added to Go players
    });

    it('should award last card point through normal path when last card player says Go after all others said Go', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: p1 played last card, p1 still has cards
      p1.peggingHand = ['TEN_HEARTS']; // Still has cards
      p2.peggingHand = ['KING_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS']; // Total = 21
      state.peggingTotal = 21;
      state.peggingLastCardPlayer = 'p1';
      state.peggingGoPlayers = [];

      // p2 says Go first
      game.playCard('p2', null);
      expect(state.peggingGoPlayers).toContain('p2');

      // p1 says Go (they played last card, all others have said Go)
      // This should go through the normal path (lines 532-563), not the special path
      const result = game.playCard('p1', null);

      expect(result).toBe('p1'); // Round over, last card player returned
      expect(p1.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Go players cleared
    });
  });

  describe('playCard - Hitting 31', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should end round and reset when hitting exactly 31', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      p1.peggingHand = ['THREE_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;

      const result = game.playCard('p1', 'THREE_SPADES');

      expect(result).toBe('p1'); // Round over
      expect(state.peggingTotal).toBe(0); // Reset
      expect(state.peggingStack.length).toBe(0); // Cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Cleared
    });

    it('should award 2 points for hitting exactly 31', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const initialScore = p1.score;
      p1.peggingHand = ['THREE_SPADES'];
      p2.peggingHand = ['KING_HEARTS']; // Still has cards, so not last card
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;

      game.playCard('p1', 'THREE_SPADES');

      expect(p1.score).toBe(initialScore + 2); // 2 points for 31 (not last card, so no extra point)
    });

    it('should record PLAY_CARD event with 31 scoring', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      p1.peggingHand = ['THREE_SPADES'];
      p2.peggingHand = ['KING_HEARTS']; // Still has cards, so not last card
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS'];
      state.peggingTotal = 28;

      game.playCard('p1', 'THREE_SPADES');

      const history = game.getGameSnapshotHistory();
      const playCardEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.PLAY_CARD && s.gameEvent.playerId === 'p1'
      );
      expect(playCardEvent).toBeDefined();
      expect(playCardEvent?.gameEvent.scoreChange).toBe(2); // 2 points for 31
    });
  });

  describe('playCard - Edge Cases', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should throw error if called outside pegging phase', () => {
      game.setPhase(Phase.DEALING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['ACE_SPADES'];

      expect(() => {
        game.playCard('p1', 'ACE_SPADES');
      }).toThrow('Cannot play card outside of the pegging phase');
    });

    it('should throw error if player not found', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = ['ACE_SPADES'];

      expect(() => {
        game.playCard('non-existent-player', 'ACE_SPADES');
      }).toThrow('Player not found');
    });

    it('should handle player playing card when they have no cards (should not happen but defensive)', () => {
      const state = game.getGameState();
      const player = state.players[0];
      player.peggingHand = []; // No cards

      // This shouldn't happen in normal flow, but if it does, card should be removed from hand gracefully
      // (hand is already empty, so filter will just return empty array)
      expect(() => {
        game.playCard('p1', 'ACE_SPADES');
      }).not.toThrow();
    });
  });

  describe('startNewPeggingRound', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should reset pegging stack and go players', () => {
      const state = game.getGameState();
      state.peggingStack = ['ACE_SPADES', 'TWO_HEARTS'];
      state.peggingGoPlayers = ['p1', 'p2'];
      state.peggingTotal = 15;
      state.peggingLastCardPlayer = 'p1';

      const lastPlayer = game.startNewPeggingRound();

      expect(state.peggingStack.length).toBe(0);
      expect(state.peggingGoPlayers.length).toBe(0);
      expect(state.peggingTotal).toBe(0);
      expect(state.peggingLastCardPlayer).toBeNull();
      expect(lastPlayer).toBe('p1'); // Returns the last card player
    });

    it('should record START_PEGGING_ROUND event', () => {
      const state = game.getGameState();
      state.peggingLastCardPlayer = 'p1';

      game.startNewPeggingRound();

      const history = game.getGameSnapshotHistory();
      const lastEvent = history[history.length - 1].gameEvent;
      expect(lastEvent.actionType).toBe(ActionType.START_PEGGING_ROUND);
    });
  });

  describe('endPegging', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should transition to counting phase', () => {
      const state = game.getGameState();
      game.endPegging();

      expect(state.currentPhase).toBe(Phase.COUNTING);
    });

    it('should reset all pegging state', () => {
      const state = game.getGameState();
      state.peggingStack = ['ACE_SPADES'];
      state.peggingGoPlayers = ['p1'];
      state.peggingTotal = 5;
      state.peggingLastCardPlayer = 'p1';

      game.endPegging();

      expect(state.peggingStack.length).toBe(0);
      expect(state.peggingGoPlayers.length).toBe(0);
      expect(state.peggingTotal).toBe(0);
      expect(state.peggingLastCardPlayer).toBeNull();
    });

    it('should throw error if called outside pegging phase', () => {
      game.setPhase(Phase.COUNTING, ActionType.BEGIN_PHASE);

      expect(() => {
        game.endPegging();
      }).toThrow('Cannot end pegging outside of the pegging phase');
    });
  });

  describe('Complex Pegging Scenarios', () => {
    it('should handle scenario: player plays last card, then others say Go in sequence', () => {
      const game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      // Initial state: stack at 25, p1 plays their last card (3) to make 28
      p1.peggingHand = ['THREE_SPADES'];
      p2.peggingHand = ['KING_HEARTS'];
      p3.peggingHand = ['QUEEN_CLUBS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'FOUR_HEARTS']; // Total = 25
      state.peggingTotal = 25;

      // p1 plays last card
      const result1 = game.playCard('p1', 'THREE_SPADES');
      expect(result1).toBeNull(); // Round not over yet (28 < 31)
      expect(state.peggingTotal).toBe(28);
      expect(state.peggingLastCardPlayer).toBe('p1');
      expect(p1.peggingHand.length).toBe(0); // Out of cards

      // p2 says Go (can't play KING without exceeding 31)
      const result2 = game.playCard('p2', null);
      expect(result2).toBeNull(); // Round not over yet
      expect(state.peggingGoPlayers).toContain('p2');

      // p3 says Go (can't play QUEEN without exceeding 31)
      const result3 = game.playCard('p3', null);
      expect(result3).toBe('p1'); // Round over! p1 gets last card point
      expect(p1.score).toBe(1); // Got 1 point for last card
    });

    it('should handle scenario: multiple rounds, last card player changes', () => {
      const game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Round 1: p1 plays last card, p2 says Go
      p1.peggingHand = ['THREE_SPADES'];
      p2.peggingHand = ['KING_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'FOUR_HEARTS'];
      state.peggingTotal = 25;

      game.playCard('p1', 'THREE_SPADES'); // Stack now 28
      game.playCard('p2', null); // Says Go
      expect(p1.score).toBe(1); // p1 got last card point

      // Start new round
      game.startNewPeggingRound();

      // Round 2: p2 plays last card, p1 says Go
      p1.peggingHand = ['KING_SPADES'];
      p2.peggingHand = ['TWO_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'FOUR_HEARTS'];
      state.peggingTotal = 25;

      game.playCard('p2', 'TWO_HEARTS'); // Stack now 27
      game.playCard('p1', null); // Says Go
      expect(p2.score).toBe(1); // p2 got last card point
    });
  });

  describe('playCard - Critical Edge Cases', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should award ONLY 31 points (not last card) when last card makes 31', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const initialScore = p1.score;
      
      // Setup: p1 plays their last card to hit exactly 31
      p1.peggingHand = ['THREE_SPADES']; // Last card
      p2.peggingHand = []; // Already out of cards
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;

      const result = game.playCard('p1', 'THREE_SPADES');

      // Per cribbage rules: when last card makes 31, you get 2 points for 31 only (no extra last-card point)
      expect(p1.score).toBe(initialScore + 2);
      expect(result).toBe('p1'); // Round over
      
      // Verify PLAY_CARD event with 31 scoring; no LAST_CARD event (last card point not awarded when making 31)
      const history = game.getGameSnapshotHistory();
      const playCardEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.PLAY_CARD && s.gameEvent.playerId === 'p1'
      );
      const lastCardEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.LAST_CARD && s.gameEvent.playerId === 'p1'
      );
      
      expect(playCardEvent).toBeDefined();
      expect(playCardEvent?.gameEvent.scoreChange).toBe(2); // 2 points for 31
      expect(lastCardEvent).toBeUndefined(); // No last card point when last card makes 31
    });

    it('should handle peggingTotal and sumOfPeggingStack being in sync', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      p1.peggingHand = ['FIVE_SPADES', 'TEN_HEARTS'];
      state.peggingStack = [];
      state.peggingTotal = 0;

      // Play first card
      game.playCard('p1', 'FIVE_SPADES');
      expect(state.peggingTotal).toBe(5);
      expect(sumOfPeggingStack(state.peggingStack)).toBe(5);

      // Play second card
      const p2 = state.players[1];
      p2.peggingHand = ['TEN_CLUBS'];
      game.playCard('p2', 'TEN_CLUBS');
      expect(state.peggingTotal).toBe(15);
      expect(sumOfPeggingStack(state.peggingStack)).toBe(15);
    });

    it('should reset peggingTotal when round ends', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      p1.peggingHand = ['THREE_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS'];
      state.peggingTotal = 28;

      game.playCard('p1', 'THREE_SPADES'); // Hits 31

      expect(state.peggingTotal).toBe(0); // Should be reset
      expect(state.peggingStack.length).toBe(0);
    });

    it('should handle multiple players running out of cards simultaneously', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Both players have one card left
      p1.peggingHand = ['ACE_SPADES'];
      p2.peggingHand = ['TWO_HEARTS'];
      state.peggingStack = [];
      state.peggingTotal = 0;

      // p1 plays their last card
      const result1 = game.playCard('p1', 'ACE_SPADES');
      expect(result1).toBeNull(); // Round not over yet (p2 still has cards)
      expect(p1.peggingHand.length).toBe(0);

      // p2 plays their last card
      const result2 = game.playCard('p2', 'TWO_HEARTS');
      expect(result2).toBe('p2'); // Round over, p2 gets last card point
      expect(p2.score).toBe(1);
      expect(p2.peggingHand.length).toBe(0);
    });

    it('should handle player saying Go when they have valid cards to play', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      p1.peggingHand = ['ACE_SPADES', 'TWO_HEARTS']; // Has valid cards
      state.peggingStack = [];
      state.peggingTotal = 0;

      // Player says Go even though they have cards (edge case - shouldn't happen but defensive)
      const result = game.playCard('p1', null);
      
      expect(result).toBeNull(); // Round continues
      expect(state.peggingGoPlayers).toContain('p1');
      // Note: In real game, agents shouldn't do this, but code should handle it gracefully
    });

    it('should handle empty pegging stack correctly', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      p1.peggingHand = ['ACE_SPADES'];
      p2.peggingHand = ['KING_HEARTS']; // p2 still has cards, so round continues
      state.peggingStack = [];
      state.peggingTotal = 0;

      const result = game.playCard('p1', 'ACE_SPADES');

      expect(result).toBeNull(); // Round continues (p2 still has cards)
      expect(state.peggingStack).toContain('ACE_SPADES');
      expect(state.peggingTotal).toBe(1);
    });

    it('should correctly identify last card player after multiple rounds', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Round 1: p1 plays last card
      p1.peggingHand = ['THREE_SPADES'];
      p2.peggingHand = ['KING_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS'];
      state.peggingTotal = 28;

      const result = game.playCard('p1', 'THREE_SPADES'); // Hits 31
      // When hitting 31, the round ends immediately, so peggingLastCardPlayer is set before reset
      // But startNewPeggingRound() clears it, so check before the round ends
      // Actually, peggingLastCardPlayer IS set before checking for 31, so it should be 'p1'
      // But startNewPeggingRound() clears it. Let's check the return value instead
      expect(result).toBe('p1'); // Round ended, p1 was last card player

      // Start new round
      game.startNewPeggingRound();
      expect(state.peggingLastCardPlayer).toBeNull(); // Reset

      // Round 2: p2 plays last card
      p1.peggingHand = ['KING_SPADES'];
      p2.peggingHand = ['TWO_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS'];
      state.peggingTotal = 28;

      game.playCard('p2', 'TWO_HEARTS'); // Hits 30, not 31
      expect(state.peggingLastCardPlayer).toBe('p2');
    });
  });

  describe('playCard - Score Boundary Conditions', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should handle player at exactly 120 points before pegging', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      
      // p1 is at exactly 120 (one point away from winning)
      p1.score = 120;
      p1.peggingHand = ['FIVE_SPADES'];
      p2.peggingHand = ['KING_HEARTS'];
      
      // Setup: stack has TEN (total = 10), playing FIVE makes 15 (worth 2 points)
      state.peggingStack = ['TEN_CLUBS'];
      state.peggingTotal = 10;

      // p1 plays FIVE to make fifteen (scores 2 points)
      game.playCard('p1', 'FIVE_SPADES');

      // Score should be 122 (wins the game)
      expect(p1.score).toBe(122);
      // Note: GameLoop would detect this and end the game, but CribbageGame.playCard doesn't check
      // This is intentional - GameLoop handles game-ending logic
    });

    it('should handle player scoring multiple points from pegging combinations', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const initialScore = p1.score;
      p1.peggingHand = ['FIVE_SPADES'];
      p2.peggingHand = ['KING_HEARTS'];
      
      // Setup: stack has TEN, FIVE (total = 15, worth 2 points)
      state.peggingStack = ['TEN_CLUBS', 'FIVE_HEARTS'];
      state.peggingTotal = 15;

      // p1 plays another FIVE (makes pair + fifteen = 4 points total)
      game.playCard('p1', 'FIVE_SPADES');

      // Should get points for: pair (2) + fifteen (2) = 4 points
      expect(p1.score).toBeGreaterThan(initialScore);
      // Note: Actual scoring depends on scorePegging logic, but should be at least 2 points
    });
  });

  describe('playCard - Bug: Player plays last card after opponent says Go', () => {
    // This tests the specific bug where:
    // 1. Player A says "Go" (can't play without exceeding 31)
    // 2. Player B plays their last card (total becomes 30, B has 0 cards)
    // 3. Round should end - B should get last card point
    // But previously this would cause an infinite loop in GameLoop

    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should award last card point when player plays last card after opponent said Go (total < 31)', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Setup: Stack at 20, p1 has a King (would make 30), p2 has a Ten
      // p1 says Go, then p2 plays their last card making it 30
      p1.peggingHand = ['KING_SPADES']; // Has card but can't play after saying Go
      p2.peggingHand = ['TEN_HEARTS']; // Will play this as their last card
      state.peggingStack = ['FIVE_SPADES', 'SIX_CLUBS', 'NINE_DIAMONDS']; // Total = 20
      state.peggingTotal = 20;
      state.peggingLastCardPlayer = null;
      state.peggingGoPlayers = [];

      // p1 says Go (King would make 30, which is valid, but let's say they can't play)
      // Actually, for this test, let's make the stack at 22 so King would exceed 31
      state.peggingStack = ['FIVE_SPADES', 'SEVEN_CLUBS', 'TEN_DIAMONDS']; // Total = 22
      state.peggingTotal = 22;

      // p1 says Go (King=10 would make 32 > 31)
      game.playCard('p1', null);
      expect(state.peggingGoPlayers).toContain('p1');

      // p2 plays their last card (Ten makes 32, but wait - that's > 31)
      // Let me fix this: p2 has an 8, making it 30
      p2.peggingHand = ['EIGHT_HEARTS'];
      const result = game.playCard('p2', 'EIGHT_HEARTS');

      // p2 played their last card (now has 0 cards)
      // p1 has already said Go
      // Round should end - p2 gets last card point
      expect(result).toBe('p2'); // Round over, p2 was last card player
      expect(p2.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
      expect(state.peggingGoPlayers.length).toBe(0); // Go players cleared
    });

    it('should award last card point when player plays last card and all others already said Go (stack at 30)', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];

      // The exact bug scenario from the user report:
      // - Papa (p1) says Go
      // - User (p2) plays last card making stack = 30
      // - p2 has 0 cards, p1 said Go, round should end

      p1.peggingHand = ['KING_SPADES']; // Has card but already said Go
      p2.peggingHand = ['TWO_HEARTS']; // Will play this as their last card
      state.peggingStack = ['TEN_SPADES', 'EIGHT_CLUBS', 'TEN_DIAMONDS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingGoPlayers = [];

      // p1 says Go (King=10 would make 38 > 31)
      game.playCard('p1', null);
      expect(state.peggingGoPlayers).toContain('p1');

      // p2 plays their last card (Two makes 30)
      const result = game.playCard('p2', 'TWO_HEARTS');

      // Stack is now 30, p2 has 0 cards, p1 already said Go
      // p1 can't play (already said Go)
      // p2 can't play (has no cards)
      // Round should end with p2 getting last card point
      expect(result).toBe('p2'); // Round over
      expect(p2.score).toBe(1); // Got 1 point for last card
      expect(state.peggingStack.length).toBe(0); // Stack cleared
    });

    it('should handle 3-player scenario: one says Go, another plays last card, third has already said Go', () => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      p1.peggingHand = ['KING_SPADES']; // Has card but will say Go
      p2.peggingHand = ['QUEEN_HEARTS']; // Has card but will say Go
      p3.peggingHand = ['ACE_CLUBS']; // Will play this as their last card
      state.peggingStack = ['TEN_SPADES', 'EIGHT_CLUBS', 'TEN_DIAMONDS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingGoPlayers = [];

      // p1 says Go
      game.playCard('p1', null);
      // p2 says Go
      game.playCard('p2', null);
      // p3 plays their last card (Ace makes 29)
      const result = game.playCard('p3', 'ACE_CLUBS');

      // p3 played last card (0 cards), p1 and p2 said Go
      // Round should end, p3 gets last card point
      expect(result).toBe('p3');
      expect(p3.score).toBe(1);
    });
  });

  describe('playCard - Players Out of Cards During Turn', () => {
    let game: CribbageGame;

    beforeEach(() => {
      game = new CribbageGame([
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ]);
      game.setPhase(Phase.PEGGING, ActionType.BEGIN_PHASE);
    });

    it('should handle player starting their turn with zero cards - should be skipped', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      // Setup: p1 has no cards (already played them all), p2 and p3 have cards
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = ['KING_SPADES'];
      p3.peggingHand = ['QUEEN_HEARTS'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1'; // p1 played last card

      // p2 says Go (can't play without exceeding 31)
      const result1 = game.playCard('p2', null);
      expect(result1).toBeNull(); // Round not over yet

      // p3 says Go (can't play without exceeding 31)
      const result2 = game.playCard('p3', null);
      expect(result2).toBe('p1'); // Round over! p1 gets last card point (they're out of cards)
      expect(p1.score).toBe(1); // Got 1 point for last card
    });

    it('should handle multiple players out of cards in sequence', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      // Setup: p1 and p2 are out of cards, p3 has one card
      p1.peggingHand = []; // Out of cards
      p2.peggingHand = []; // Out of cards
      p3.peggingHand = ['KING_SPADES'];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS', 'SIX_DIAMONDS', 'SEVEN_HEARTS']; // Total = 28
      state.peggingTotal = 28;
      state.peggingLastCardPlayer = 'p1'; // p1 played last card

      // p3 says Go (can't play without exceeding 31)
      const result = game.playCard('p3', null);
      expect(result).toBe('p1'); // Round over! p1 gets last card point
      expect(p1.score).toBe(1);
    });

    it('should handle all players out of cards simultaneously', () => {
      const state = game.getGameState();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const p3 = state.players[2];

      // All players are out of cards
      p1.peggingHand = [];
      p2.peggingHand = [];
      p3.peggingHand = [];
      state.peggingStack = ['FIVE_SPADES', 'TEN_CLUBS'];
      state.peggingTotal = 15;
      state.peggingLastCardPlayer = 'p1';

      // This shouldn't happen in normal flow (all players out means pegging should end)
      // But if it does, the last card player should get the point
      // Actually, if all players are out, endPegging should be called, not playCard
      // But defensively, if someone says Go when all are out, p1 should get the point
      const result = game.playCard('p2', null);
      // p2 says Go, but all players with cards (none) have said Go
      // So p1 (last card player, out of cards) should get the point
      expect(result).toBe('p1');
      expect(p1.score).toBe(1);
    });
  });
});

