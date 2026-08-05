// Single token-counting method for every figure in the benchmark.
// o200k_base via gpt-tokenizer: a public, reproducible tokenizer applied
// identically to all surfaces. It approximates (does not equal) any given
// model's tokenizer; comparisons between surfaces remain valid because the
// same encoding counts every figure.
import { encode } from "gpt-tokenizer/encoding/o200k_base";

export const TOKEN_METHOD = "gpt-tokenizer o200k_base";

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}
