/**
 * Throw this from a processor when retrying can never help:
 * the recipient address is invalid, the document doesn't exist, the input file is corrupt.
 * The handler stops retrying immediately and records the failure.
 *
 * Any OTHER error is treated as transient (timeouts, 5xx, rate limits) and retried with backoff.
 */
export class PermanentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PermanentError";
    }
}