import { RandomAgent } from './RandomAgent';
import { SimpleAgent } from './SimpleAgent';
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
  SimpleAgent,
  HeuristicSimpleAgent,
  WebSocketAgent,
  DelayedSimpleAgent,
  RandomDelaySimpleAgent,
  Fixed500msSimpleAgent,
  Fixed200msSimpleAgent,
};
