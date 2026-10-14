import type { MoveUnitCommand } from "@warfront/protocol";
import {
  Simulation,
  type Clock,
  type WorldSnapshot,
} from "@warfront/simulation";
import { WorldStore } from "./world-store.js";

export class MatchHost {
  private simulation: Simulation;
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private tickPending = false;

  private constructor(
    private readonly clock: Clock,
    private readonly store: WorldStore,
    private readonly matchId: string,
    restored: WorldSnapshot | undefined,
    private readonly publish: (state: WorldSnapshot) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.simulation = new Simulation(clock, restored, matchId);
  }

  static async create(
    clock: Clock,
    store: WorldStore,
    matchId: string,
    publish: (state: WorldSnapshot) => void,
    onError: (error: unknown) => void,
  ): Promise<MatchHost> {
    const restored = await store.load(matchId);
    return new MatchHost(clock, store, matchId, restored, publish, onError);
  }

  snapshot(): WorldSnapshot {
    return this.simulation.snapshot();
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.tickPending) return;
      this.tickPending = true;
      void this.enqueue(async () => {
        const state = this.simulation.advance();
        this.publish(state);
        if (state.tick % 10 === 0) await this.store.save(state);
      })
        .catch(this.onError)
        .finally(() => {
          this.tickPending = false;
        });
    }, 200);
  }

  command(playerId: string, command: MoveUnitCommand): Promise<WorldSnapshot> {
    return this.enqueue(async () => {
      const before = this.simulation.snapshot();
      this.simulation.command(playerId, command);
      const state = this.simulation.snapshot();
      try {
        await this.store.save(state);
      } catch (error) {
        this.simulation = new Simulation(this.clock, before);
        throw error;
      }
      this.publish(state);
      return state;
    });
  }

  addPlayer(playerId: string): Promise<WorldSnapshot> {
    return this.enqueue(async () => {
      const before = this.simulation.snapshot();
      const state = this.simulation.addPlayer(playerId);
      try {
        await this.store.save(state);
      } catch (error) {
        this.simulation = new Simulation(this.clock, before, this.matchId);
        throw error;
      }
      this.publish(state);
      return state;
    });
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue;
    await this.store.save(this.simulation.snapshot());
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
