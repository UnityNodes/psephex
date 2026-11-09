import { useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

type Enter = { initial?: TargetAndTransition | false; animate?: TargetAndTransition; transition?: Transition };

export function useEnter(from: TargetAndTransition, delay = 0, duration = 0.32): Enter {
  const still = useReducedMotion() === true;
  if (still) return {};
  const to = Object.fromEntries(Object.keys(from).map((k) => [k, k === "opacity" || k.startsWith("scale") ? 1 : 0])) as TargetAndTransition;
  return { initial: from, animate: to, transition: { duration, ease: EASE_OUT, delay } };
}
