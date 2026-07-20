import { FACE_MATCH_THRESHOLD } from "./constants";
import type { Employee } from "./types";

export function euclideanDistance(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export interface MatchResult {
  employee: Employee;
  distance: number;
}

/**
 * Compares a live descriptor against every descriptor of every active
 * employee (each may have 1-3 enrolled snapshots) and returns the closest
 * one under `threshold`, or null if nothing qualifies as a candidate match.
 */
export function findBestMatch(
  liveDescriptor: Float32Array,
  employees: Employee[],
  threshold: number = FACE_MATCH_THRESHOLD
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const employee of employees) {
    if (!employee.active) continue;
    for (const descriptor of employee.faceDescriptors) {
      const distance = euclideanDistance(liveDescriptor, descriptor);
      if (distance < threshold && (!best || distance < best.distance)) {
        best = { employee, distance };
      }
    }
  }
  return best;
}
