export type MyobFactories = import("./factories").MyobFactories;
export type MyobClientConfig = import("../client").MyobClientConfig;
export type MyobClient = ReturnType<typeof createMyobClient>;
/**
 * A request the mock received, parsed.
 */
export type MockRequest = {
    /**
     * - e.g. `"employees.list"`, or `"GET Sale/Order/Item"` for a route
     * added with `onRequest`.
     */
    operation: string;
    method: string;
    url: string;
    /**
     * - `uid` is the record UID (the employee UID for timesheets).
     */
    params: {
        uid?: string;
    };
    /**
     * - Decoded, with OData keys as sent (`$top`, `$filter`).
     */
    query: Record<string, string>;
    /**
     * - Parsed JSON body, if any.
     */
    body: any;
    headers: Record<string, string>;
};
export type MockResponse = {
    status: number;
    body?: unknown;
    headers?: Record<string, string> | undefined;
};
export type MockErrorBody = {
    /**
     * - MYOB's `Errors[].Name`, e.g. `"ResourceNotFound"`.
     */
    name?: string | undefined;
    message?: string | undefined;
    /**
     * - Sent as `x-request-id`.
     */
    requestId?: string | undefined;
};
export type MockHandlers = {
    /**
     *   Answer every matching request (the latest `reply` wins).
     */
    reply: (status: number, body?: unknown | ((request: MockRequest) => unknown), headers?: Record<string, string>) => MockHandlers;
    /**
     *   Answer the next matching request only. Queued `replyOnce`s run in order before any `reply`.
     */
    replyOnce: (status: number, body?: unknown | ((request: MockRequest) => unknown), headers?: Record<string, string>) => MockHandlers;
    /**
     *   An error in MYOB's `{ Errors: [...] }` shape, so the SDK throws its real error class.
     */
    replyError: (status: number, error?: MockErrorBody, options?: {
        once?: boolean;
    }) => MockHandlers;
    /**
     * - Successive pages linked by
     * `NextPageLink`, so `iterate`/`all` page for real. Each page answers once.
     */
    replyPages: (pages: unknown[][]) => MockHandlers;
    /**
     * - `MyobConnectionError`.
     */
    networkError: (options?: {
        once?: boolean;
    }) => MockHandlers;
    /**
     * - `MyobTimeoutError`.
     */
    timeout: (options?: {
        once?: boolean;
    }) => MockHandlers;
};
export type MyobMock = {
    /**
     * - Every operation name `on` accepts.
     */
    operations: readonly string[];
    on: (operation: string) => MockHandlers;
    /**
     * - Handle a path the typed
     * operations don't cover, as called through the generic methods (`api.get("Sale/Order/Item")`).
     * `path` is relative to the company file and matched exactly, without the query string. Its
     * calls are recorded under the operation `"<METHOD> <path>"`. Checked before the typed operations.
     */
    onRequest: (method: string, path: string) => MockHandlers;
    /**
     * - Requests received, in order.
     */
    calls: (operation?: string) => MockRequest[];
    /**
     * - Operations with handlers that were set up but never used;
     * usually a sign of a broken test.
     */
    pending: () => string[];
    /**
     * - Drop all handlers, `onRequest` routes and recorded calls.
     */
    reset: () => void;
};
export type CreateMockMyobOptions = {
    /**
     * - Seed for `fake`; the same seed gives the same records. Defaults to 1.
     */
    seed?: number | undefined;
    businessId?: string | undefined;
    /**
     * -
     * Extra client options. Retries and rate limiting are off unless set here.
     */
    client?: Omit<import("../client").MyobClientConfig, "fetch" | "tokens" | "businessId" | "connection" | "auth"> | undefined;
};
export type Operation = {
    name: string;
    method: string;
    path: string | null;
    kind: "root" | "collection" | "record";
    resource: string;
};
/**
 * A real `createMyobClient` over a fake `fetch`, for unit-testing code that uses the SDK without
 * calling MYOB. URL building, response parsing, paging and error classes all run for real; the
 * mock only decides which response comes back. Unhandled operations get a realistic default
 * response from `fake`. A request that matches no operation never reaches the network: it gets a
 * 501, which the client throws as a (non-retried) `MyobInternalServerError` naming the request.
 *
 * @param {CreateMockMyobOptions} [options]
 * @returns {{ client: MyobClient, mock: MyobMock, fake: MyobFactories }}
 */
export function createMockMyob({ seed, businessId, client: clientOptions }?: CreateMockMyobOptions): {
    client: MyobClient;
    mock: MyobMock;
    fake: MyobFactories;
};
import { createMyobClient } from "../client";
