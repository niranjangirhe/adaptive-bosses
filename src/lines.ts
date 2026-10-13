/**
 * Authored taunts, one per counter. They are what the boss says when no
 * language model is running.
 */
import type { Counter } from "./fight.ts";

export const AUTHORED: Record<Counter | "none", string> = {
  charge: "Keep your distance if you like. I'll close it for you.",
  delay: "Roll all you want. I can wait.",
  rearguard: "Behind me again? Not this time.",
  comboblock: "Same opening as last time? I've seen it enough.",
  none: "Come on, then. Show me what you've got.",
};
