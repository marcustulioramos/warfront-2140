import { sectorAt, sectorDistance } from "@warfront/shared";
import type { WorldSnapshot } from "@warfront/simulation";

export function visibleSectors(
  state: WorldSnapshot,
  playerId: string,
): Set<string> {
  const sources = [
    ...state.units
      .filter((unit) => unit.ownerId === playerId)
      .map((unit) => sectorAt(unit.position)),
    ...state.buildings
      .filter((building) => building.ownerId === playerId)
      .map((building) => sectorAt(building.position)),
    ...state.sectors
      .filter((sector) => sector.ownerId === playerId)
      .map((sector) => sector.id),
  ];
  return new Set(
    state.sectors
      .filter((sector) =>
        sources.some((source) => sectorDistance(source, sector.id) <= 1),
      )
      .map((sector) => sector.id),
  );
}

export function visibleSnapshot(
  state: WorldSnapshot,
  playerId: string,
): WorldSnapshot {
  const sectors = visibleSectors(state, playerId);
  const visible = (position: { x: number; z: number }) =>
    sectors.has(sectorAt(position));
  const travellingEnemy = new Set(
    state.armies
      .filter((army) => army.ownerId !== playerId && army.arrivesAtMs !== null)
      .flatMap((army) => army.unitIds),
  );
  const units = state.units.filter(
    (unit) =>
      unit.ownerId === playerId ||
      (visible(unit.position) && !travellingEnemy.has(unit.id)),
  );
  const buildings = state.buildings.filter(
    (building) => building.ownerId === playerId || visible(building.position),
  );
  const knownIds = new Set([...units, ...buildings].map((item) => item.id));
  return {
    ...state,
    units: units.map((unit) =>
      unit.targetId && !knownIds.has(unit.targetId)
        ? { ...unit, targetId: null }
        : unit,
    ),
    buildings,
    resourceNodes: state.resourceNodes.filter((node) => visible(node.position)),
    combatEvents: state.combatEvents.filter(
      (event) => visible(event.from) && visible(event.to),
    ),
    armies: state.armies.filter((army) => army.ownerId === playerId),
    battleReports: state.battleReports.filter(
      (report) => report.ownerId === playerId,
    ),
    recovery: state.recovery.filter((item) => item.playerId === playerId),
    research: state.research.filter((item) => item.playerId === playerId),
    production: state.production.filter((item) => item.ownerId === playerId),
    resources: state.resources.filter((item) => item.playerId === playerId),
    sectors: state.sectors.map((sector) =>
      sectors.has(sector.id)
        ? { ...sector, visible: true }
        : { ...sector, ownerId: null, visible: false },
    ),
  };
}
