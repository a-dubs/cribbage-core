import { RandomAgent } from './RandomAgent';
import { ExhaustiveSimpleAgent } from './ExhaustiveSimpleAgent';
import { HeuristicSimpleAgent } from './HeuristicSimpleAgent';
import { WebSocketAgent } from './WebSocketAgent';
import {
  DelayedSimpleAgent,
  RandomDelaySimpleAgent,
  Fixed500msSimpleAgent,
  Fixed200msSimpleAgent,
} from './DelayedSimpleAgent';

export const agents = {
  RandomAgent,
  ExhaustiveSimpleAgent,
  HeuristicSimpleAgent,
  WebSocketAgent,
  DelayedSimpleAgent,
  RandomDelaySimpleAgent,
  Fixed500msSimpleAgent,
  Fixed200msSimpleAgent,
};
