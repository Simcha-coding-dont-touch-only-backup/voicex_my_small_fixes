import type { Request, Response } from 'express';
import type { IvrNode } from '@voicex/shared';

export interface HandlerContext {
  req: Request;
  res: Response;
  node: IvrNode;
  callSid: string;
  userId: string | null;
  flowVersionId: string;
  sessionData: Record<string, string>;
}

export interface HandlerResult {
  type: 'twiml';
  twiml: string;
}

export type IvrHandler = (ctx: HandlerContext) => Promise<HandlerResult>;

const registry = new Map<string, IvrHandler>();

export function registerHandler(name: string, handler: IvrHandler): void {
  registry.set(name, handler);
}

export function getHandler(name: string): IvrHandler | undefined {
  return registry.get(name);
}

export function getHandlerNames(): string[] {
  return Array.from(registry.keys());
}

import './init-handlers.js';
