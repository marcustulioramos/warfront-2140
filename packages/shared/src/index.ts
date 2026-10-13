export type MatchId = string;
export type PlayerId = string;
export type UnitId = string;

export const WORLD_HALF_SIZE = 20;

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface UnitView {
  readonly id: UnitId;
  readonly ownerId: PlayerId;
  readonly position: Point;
  readonly destination: Point | null;
}

export interface WorldView {
  readonly matchId: MatchId;
  readonly tick: number;
  readonly units: readonly UnitView[];
}
