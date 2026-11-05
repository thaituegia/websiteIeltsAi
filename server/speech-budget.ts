import { ApiError } from "./errors";

export interface SpeechGenerationLimits {
  maxProviderRequests: number;
  /** Serialized request characters, including instructions and JSON metadata.
   * This is a conservative input bound, never an estimate of billed dollars. */
  maxInputCharacters: number;
}

export interface SpeechGenerationUsage extends SpeechGenerationLimits {
  providerRequests: number;
  inputCharacters: number;
  remainingProviderRequests: number;
  remainingInputCharacters: number;
}

export class SpeechBudgetExceededError extends ApiError {
  readonly kind = "budget-exhausted";
  constructor(public readonly reason: "provider-requests" | "input-characters") {
    super(409, "Đã chạm giới hạn tạo audio của lần chạy này; không gọi AI thêm.");
    this.name = "SpeechBudgetExceededError";
  }
}

/** One explicitly bounded generation run. Keep the SAME object for every
 * clip, retry and watch pass. Failed/aborted attempts are not refunded. */
export class SpeechGenerationBudget {
  readonly #maxProviderRequests: number;
  readonly #maxInputCharacters: number;
  #providerRequests = 0;
  #inputCharacters = 0;

  constructor(limits: SpeechGenerationLimits = { maxProviderRequests: 0, maxInputCharacters: 0 }) {
    if (![limits.maxProviderRequests, limits.maxInputCharacters].every(value => Number.isSafeInteger(value) && value >= 0))
      throw new Error("Speech generation limits must be nonnegative safe integers.");
    this.#maxProviderRequests = limits.maxProviderRequests;
    this.#maxInputCharacters = limits.maxInputCharacters;
  }

  /** Synchronous reservation immediately before fetch prevents concurrent
   * provider turns from exceeding the shared allowance. Cache hits skip it. */
  consume(inputCharacters: number): void {
    if (!Number.isSafeInteger(inputCharacters) || inputCharacters < 0)
      throw new Error("Speech request input length must be a nonnegative safe integer.");
    if (this.#providerRequests >= this.#maxProviderRequests)
      throw new SpeechBudgetExceededError("provider-requests");
    if (inputCharacters > this.#maxInputCharacters - this.#inputCharacters)
      throw new SpeechBudgetExceededError("input-characters");
    this.#providerRequests++;
    this.#inputCharacters += inputCharacters;
  }

  snapshot(): Readonly<SpeechGenerationUsage> {
    return Object.freeze({
      maxProviderRequests: this.#maxProviderRequests,
      maxInputCharacters: this.#maxInputCharacters,
      providerRequests: this.#providerRequests,
      inputCharacters: this.#inputCharacters,
      remainingProviderRequests: this.#maxProviderRequests - this.#providerRequests,
      remainingInputCharacters: this.#maxInputCharacters - this.#inputCharacters,
    });
  }
}
