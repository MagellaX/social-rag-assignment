import type { SourceFile } from "../types";
import type { SourceParser } from "./base";
import { InstagramParser } from "./instagram";
import { LinkedInParser } from "./linkedin";
import { TwitterParser } from "./twitter";

export const parsers: SourceParser[] = [new LinkedInParser(), new TwitterParser(), new InstagramParser()];

export function parserFor(file: SourceFile): SourceParser | undefined {
  return parsers.find((parser) => parser.canParse(file));
}
