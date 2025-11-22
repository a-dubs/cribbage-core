import { CribbageGame } from '../src/core/CribbageGame';
import { PlayerIdAndName, Phase, ActionType } from '../src/types';
import { getPlayerCountConfig, getExpectedCribSize } from '../src/gameplay/rules';

describe('CribbageGame - Multi-Player Support', () => {
  describe('Player Count Validation', () => {
    it('should accept 2 players', () => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ];
      expect(() => new CribbageGame(players)).not.toThrow();
    });

    it('should accept 3 players', () => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ];
      expect(() => new CribbageGame(players)).not.toThrow();
    });

    it('should accept 4 players', () => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
        { id: 'p4', name: 'Player 4' },
      ];
      expect(() => new CribbageGame(players)).not.toThrow();
    });

    it('should reject 1 player', () => {
      const players: PlayerIdAndName[] = [{ id: 'p1', name: 'Player 1' }];
      expect(() => new CribbageGame(players)).toThrow(
        'Invalid player count: 1. Games must have between 2 and 4 players.'
      );
    });

    it('should reject 5 players', () => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
        { id: 'p4', name: 'Player 4' },
        { id: 'p5', name: 'Player 5' },
      ];
      expect(() => new CribbageGame(players)).toThrow(
        'Invalid player count: 5. Games must have between 2 and 4 players.'
      );
    });
  });

  describe('2-Player Game Rules', () => {
    let game: CribbageGame;

    beforeEach(() => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ];
      game = new CribbageGame(players);
      // Set dealer for testing
      game.getGameState().players[0].isDealer = true;
    });

    it('should deal 6 cards per player', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      expect(state.players[0].hand.length).toBe(6);
      expect(state.players[1].hand.length).toBe(6);
    });

    it('should have empty crib after startRound', () => {
      game.startRound();
      const state = game.getGameState();
      expect(state.crib.length).toBe(0);
    });

    it('should expect 4 cards in crib after discards', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      
      // Each player discards 2 cards
      const p1Discards = state.players[0].hand.slice(0, 2);
      const p2Discards = state.players[1].hand.slice(0, 2);
      
      game.discardToCrib('p1', p1Discards);
      game.discardToCrib('p2', p2Discards);
      
      expect(state.crib.length).toBe(4);
      expect(() => game.completeCribPhase()).not.toThrow();
    });

    it('should validate expected crib size', () => {
      expect(getExpectedCribSize(2)).toBe(4);
    });
  });

  describe('3-Player Game Rules', () => {
    let game: CribbageGame;

    beforeEach(() => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
      ];
      game = new CribbageGame(players);
      // Set dealer for testing
      game.getGameState().players[0].isDealer = true;
    });

    it('should auto-deal 1 card to crib during startRound', () => {
      game.startRound();
      const state = game.getGameState();
      
      // Crib should have 1 auto-dealt card before player dealing
      expect(state.crib.length).toBe(1);
      
      // Verify AUTO_CRIB_CARD event was recorded
      const history = game.getGameSnapshotHistory();
      const autoCribEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.AUTO_CRIB_CARD
      );
      expect(autoCribEvent).toBeDefined();
      expect(autoCribEvent?.gameEvent.cards?.length).toBe(1);
    });

    it('should deal 5 cards per player', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      expect(state.players[0].hand.length).toBe(5);
      expect(state.players[1].hand.length).toBe(5);
      expect(state.players[2].hand.length).toBe(5);
    });

    it('should expect 4 cards in crib after 1 auto + 3 discards', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      
      // Crib starts with 1 auto card
      expect(state.crib.length).toBe(1);
      
      // Each player discards 1 card
      const p1Discards = state.players[0].hand.slice(0, 1);
      const p2Discards = state.players[1].hand.slice(0, 1);
      const p3Discards = state.players[2].hand.slice(0, 1);
      
      game.discardToCrib('p1', p1Discards);
      game.discardToCrib('p2', p2Discards);
      game.discardToCrib('p3', p3Discards);
      
      expect(state.crib.length).toBe(4);
      expect(() => game.completeCribPhase()).not.toThrow();
    });

    it('should reject completeCribPhase with incorrect crib size', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      
      // Only 2 players discard (should have 3 cards total: 1 auto + 2 discards)
      const p1Discards = state.players[0].hand.slice(0, 1);
      const p2Discards = state.players[1].hand.slice(0, 1);
      
      game.discardToCrib('p1', p1Discards);
      game.discardToCrib('p2', p2Discards);
      
      expect(state.crib.length).toBe(3);
      expect(() => game.completeCribPhase()).toThrow(
        'Crib phase not complete. Ensure all players discarded. Expected 4 cards in crib, but found 3.'
      );
    });

    it('should validate expected crib size', () => {
      expect(getExpectedCribSize(3)).toBe(4);
    });

    it('should redact auto-crib card until counting phase', () => {
      game.startRound();
      const state = game.getGameState();
      
      // Get redacted snapshot for player 1
      const redactedSnapshot = game.getRedactedGameSnapshot('p1');
      
      // Crib cards should be UNKNOWN before counting
      expect(redactedSnapshot.gameState.crib.every((c) => c === 'UNKNOWN')).toBe(true);
      
      // Find AUTO_CRIB_CARD event and verify it's redacted
      const history = game.getGameSnapshotHistory();
      const autoCribEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.AUTO_CRIB_CARD
      );
      expect(autoCribEvent).toBeDefined();
      
      if (autoCribEvent) {
        const redactedEvent = game.getRedactedGameEvent(autoCribEvent.gameEvent, 'p1');
        expect(redactedEvent.cards?.every((c) => c === 'UNKNOWN')).toBe(true);
      }
    });
  });

  describe('4-Player Game Rules', () => {
    let game: CribbageGame;

    beforeEach(() => {
      const players: PlayerIdAndName[] = [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
        { id: 'p3', name: 'Player 3' },
        { id: 'p4', name: 'Player 4' },
      ];
      game = new CribbageGame(players);
      // Set dealer for testing
      game.getGameState().players[0].isDealer = true;
    });

    it('should not auto-deal cards to crib', () => {
      game.startRound();
      const state = game.getGameState();
      
      // Crib should be empty (no auto-dealt cards)
      expect(state.crib.length).toBe(0);
      
      // Verify no AUTO_CRIB_CARD event was recorded
      const history = game.getGameSnapshotHistory();
      const autoCribEvent = history.find(
        (s) => s.gameEvent.actionType === ActionType.AUTO_CRIB_CARD
      );
      expect(autoCribEvent).toBeUndefined();
    });

    it('should deal 5 cards per player', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      expect(state.players[0].hand.length).toBe(5);
      expect(state.players[1].hand.length).toBe(5);
      expect(state.players[2].hand.length).toBe(5);
      expect(state.players[3].hand.length).toBe(5);
    });

    it('should expect 4 cards in crib after 4 discards', () => {
      game.startRound();
      game.deal();
      const state = game.getGameState();
      
      // Each player discards 1 card
      const p1Discards = state.players[0].hand.slice(0, 1);
      const p2Discards = state.players[1].hand.slice(0, 1);
      const p3Discards = state.players[2].hand.slice(0, 1);
      const p4Discards = state.players[3].hand.slice(0, 1);
      
      game.discardToCrib('p1', p1Discards);
      game.discardToCrib('p2', p2Discards);
      game.discardToCrib('p3', p3Discards);
      game.discardToCrib('p4', p4Discards);
      
      expect(state.crib.length).toBe(4);
      expect(() => game.completeCribPhase()).not.toThrow();
    });

    it('should validate expected crib size', () => {
      expect(getExpectedCribSize(4)).toBe(4);
    });
  });

  describe('Configuration Helper', () => {
    it('should return correct config for 2 players', () => {
      const config = getPlayerCountConfig(2);
      expect(config.handSize).toBe(6);
      expect(config.discardPerPlayer).toBe(2);
      expect(config.autoCribCardsFromDeck).toBe(0);
    });

    it('should return correct config for 3 players', () => {
      const config = getPlayerCountConfig(3);
      expect(config.handSize).toBe(5);
      expect(config.discardPerPlayer).toBe(1);
      expect(config.autoCribCardsFromDeck).toBe(1);
    });

    it('should return correct config for 4 players', () => {
      const config = getPlayerCountConfig(4);
      expect(config.handSize).toBe(5);
      expect(config.discardPerPlayer).toBe(1);
      expect(config.autoCribCardsFromDeck).toBe(0);
    });

    it('should throw for invalid player count', () => {
      expect(() => getPlayerCountConfig(1)).toThrow();
      expect(() => getPlayerCountConfig(5)).toThrow();
    });
  });
});
