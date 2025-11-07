import { RandomAgent } from './RandomAgent';
import { SimpleAgent } from './SimpleAgent';
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
  WebSocketAgent,
  DelayedSimpleAgent,
  RandomDelaySimpleAgent,
  Fixed500msSimpleAgent,
  Fixed200msSimpleAgent,
};
