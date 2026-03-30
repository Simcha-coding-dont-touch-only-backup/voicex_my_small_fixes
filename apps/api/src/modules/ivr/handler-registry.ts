import type { Request, Response } from 'express';
import type { IvrNode } from '@voicex/shared';
import type { TeltechResponse } from '../../lib/teltech.js';

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
  type: 'actions';
  response: TeltechResponse;
}

export type IvrHandler = (ctx: HandlerContext) => Promise<HandlerResult>;

let registry: Map<string, IvrHandler> | undefined;

function getRegistry(): Map<string, IvrHandler> {
  if (!registry) {
    registry = new Map();
  }
  return registry;
}

export function registerHandler(name: string, handler: IvrHandler): void {
  getRegistry().set(name, handler);
}

export function getHandler(name: string): IvrHandler | undefined {
  return getRegistry().get(name);
}

export function getHandlerNames(): string[] {
  return Array.from(getRegistry().keys());
}
