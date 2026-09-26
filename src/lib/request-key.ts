import { AsyncLocalStorage } from 'node:async_hooks';
export type RequestKey = { merchantId: string; actorId: string; key: string; action: string };
export const requestKey = new AsyncLocalStorage<RequestKey>();
