import {
  parseFlags,
  type FlagSpec,
  type ParsedFlags,
} from "@atlassian-axi/core";

/**
 * parseFlags for the Confluence commands. Every one of them is dispatched
 * through cli.ts stripSite, so `--site` is already gone from `args` by the
 * time they parse: record it as consumed here (once, rather than at every
 * call site) or an unknown-flag error would omit the one flag they all take.
 */
export function parseSiteFlags(args: string[], spec: FlagSpec): ParsedFlags {
  return parseFlags(args, {
    ...spec,
    consumed: [...(spec.consumed ?? []), "--site"],
  });
}
