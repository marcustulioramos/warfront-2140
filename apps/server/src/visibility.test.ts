import { describe, expect, it } from "vitest";
import { ManualClock, Simulation } from "@warfront/simulation";
import { visibleSnapshot } from "./visibility.js";

describe("player visibility", () => {
  it("shows a killing shot even after its target leaves the world", () => {
    const game = new Simulation(new ManualClock(0), undefined, "combat-fog");
    game.addPlayer("a");
    const state = game.snapshot();
    const view = visibleSnapshot(
      {
        ...state,
        combatEvents: [
          {
            attackerId: "unit-a",
            targetId: "destroyed-b",
            from: { x: -10, z: 0 },
            to: { x: -5, z: 0 },
            damage: 7,
            destroyed: true,
          },
        ],
      },
      "a",
    );
    expect(view.combatEvents).toHaveLength(1);
  });
  it("hides remote enemies, private economy, armies, and reports", () => {
    const game = new Simulation(new ManualClock(0), undefined, "fog-test");
    game.addPlayer("a");
    game.addPlayer("b");
    const original = game.snapshot();
    const moved = {
      ...original,
      units: original.units.map((unit) =>
        unit.ownerId === "b" ? { ...unit, position: { x: 19, z: 19 } } : unit,
      ),
    };
    const view = visibleSnapshot(moved, "a");
    expect(view.units.every((unit) => unit.ownerId === "a")).toBe(true);
    expect(view.resources.map((resource) => resource.playerId)).toEqual(["a"]);
    expect(view.research.map((research) => research.playerId)).toEqual(["a"]);
    expect(view.sectors.find((sector) => sector.id === "3-3")?.visible).toBe(
      false,
    );
    expect(view.sectors.some((sector) => sector.visible)).toBe(true);
    expect(original.units).toHaveLength(6);
  });
});
