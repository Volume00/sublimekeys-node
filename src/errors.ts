export class SublimeKeysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SublimeKeysError";
  }
}

/** A request to the SublimeKeys API failed to complete (unreachable host, timeout, connection reset, ...). */
export class NetworkError extends SublimeKeysError {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** A cached offline lease failed verification — malformed, tampered, expired,
 * or scoped to a different license/machine/product. */
export class LeaseError extends SublimeKeysError {
  constructor(message: string) {
    super(message);
    this.name = "LeaseError";
  }
}
