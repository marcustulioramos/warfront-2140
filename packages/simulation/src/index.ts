import type { ClientCommand } from "@warfront/protocol";
import { snapshotVersion } from "@warfront/protocol";
import {
  ECONOMY,
  RECOVERY,
  SECTOR_SIZE,
  UNIT_STATS,
  WORLD_HALF_SIZE,
  sectorAt,
  sectorRoute,
  startingSectors,
  type CombatEvent,
  type ArmyView,
  type BattleReport,
  type Point,
  type UnitRole,
  type UnitView,
  type WorldView,
} from "@warfront/shared";

export interface Clock {
  nowMs(): number;
}

export class ManualClock implements Clock {
  constructor(private currentMs = 0) {}
  nowMs(): number {
    return this.currentMs;
  }
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("Invalid duration");
    this.currentMs += ms;
  }
}

export class RealClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export interface WorldSnapshot extends WorldView {
  readonly snapshotVersion: typeof snapshotVersion;
  readonly lastSimulatedAtMs: number;
}
export function startingEconomy(
  playerIds: readonly string[],
): Pick<WorldView, "resourceNodes" | "buildings" | "production" | "resources"> {
  return {
    resourceNodes: playerIds.map((id, index) => ({
      id: `node-${id}`,
      position: { x: index === 0 ? -14 : 14, z: -10 },
    })),
    buildings: [],
    production: [],
    resources: playerIds.map((playerId) => ({
      playerId,
      ore: ECONOMY.startingOre,
    })),
  };
}

function makeUnit(
  id: string,
  ownerId: string,
  role: UnitRole,
  position: Point,
): UnitView {
  const stats = UNIT_STATS[role];
  return {
    id,
    ownerId,
    role,
    position,
    destination: null,
    targetId: null,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    cooldownMs: 0,
  };
}

export class Simulation {
  private world: WorldSnapshot;

  constructor(
    private readonly clock: Clock,
    snapshot?: WorldSnapshot,
    matchId?: string,
  ) {
    this.world = snapshot
      ? {
          ...structuredClone(snapshot),
          lastSimulatedAtMs: snapshot.lastSimulatedAtMs,
          combatEvents: [],
        }
      : {
          snapshotVersion,
          matchId: matchId ?? "development",
          tick: 0,
          lastSimulatedAtMs: clock.nowMs(),
          playerIds: matchId ? [] : ["player-1"],
          sectors: startingSectors(),
          units: matchId
            ? []
            : [makeUnit("unit-1", "player-1", "scout", { x: 0, z: 0 })],
          combatEvents: [],
          armies: [],
          battleReports: [],
          recovery: [],
          research: matchId ? [] : [{ playerId: "player-1", completed: [] }],
          ...startingEconomy(matchId ? [] : ["player-1"]),
        };
    if (snapshot) {
      this.settleEconomy(clock.nowMs());
      this.settleArmies(clock.nowMs());
      this.evaluateDefeats(clock.nowMs());
      this.settleRecovery(clock.nowMs());
    }
  }

  snapshot(): WorldSnapshot {
    return structuredClone(this.world);
  }

  addPlayer(playerId: string): WorldSnapshot {
    if (this.world.playerIds.includes(playerId)) return this.snapshot();
    if (this.world.playerIds.length >= 2) throw new Error("Match is full");
    const x = this.world.playerIds.length === 0 ? -10 : 10;
    this.world = {
      ...this.world,
      playerIds: [...this.world.playerIds, playerId],
      resourceNodes: [
        ...this.world.resourceNodes,
        {
          id: `node-${playerId}`,
          position: { x: this.world.playerIds.length === 0 ? -14 : 14, z: -10 },
        },
      ],
      resources: [
        ...this.world.resources,
        { playerId, ore: ECONOMY.startingOre },
      ],
      research: [...this.world.research, { playerId, completed: [] }],
      units: [
        ...this.world.units,
        makeUnit(`unit-${playerId}`, playerId, "scout", { x, z: 0 }),
        makeUnit(`medium-${playerId}`, playerId, "medium", { x, z: -4 }),
        makeUnit(`artillery-${playerId}`, playerId, "artillery", { x, z: 4 }),
      ],
    };
    return this.snapshot();
  }

  command(playerId: string, command: ClientCommand): void {
    if (
      this.world.recovery.some(
        (item) => item.playerId === playerId && item.respawnAtMs !== null,
      )
    )
      throw new Error("Recovery is pending");
    if (command.type === "CREATE_ARMY") {
      this.createArmy(
        playerId,
        command.commandId,
        command.name,
        command.unitIds,
      );
      return;
    }
    if (command.type === "ORDER_ARMY") {
      this.orderArmy(
        playerId,
        command.armyId,
        command.destination,
        command.stance,
        command.retreatThreshold,
        command.postBattle,
      );
      return;
    }
    if (command.type === "BUILD_STRUCTURE") {
      this.build(playerId, command.kind, command.nodeId);
      return;
    }
    if (command.type === "PRODUCE_UNIT") {
      this.produce(
        playerId,
        command.factoryId,
        command.role,
        command.commandId,
      );
      return;
    }
    const unit = this.world.units.find((item) => item.id === command.unitId);
    if (!unit || unit.ownerId !== playerId)
      throw new Error("Unit is not owned by player");
    if (
      this.world.armies.some(
        (army) => army.arrivesAtMs !== null && army.unitIds.includes(unit.id),
      )
    )
      throw new Error("Unit is travelling with an army");
    if (command.type === "MOVE_UNIT") {
      const destination = command.destination;
      if (
        Math.abs(destination.x) > WORLD_HALF_SIZE ||
        Math.abs(destination.z) > WORLD_HALF_SIZE
      )
        throw new Error("Destination outside map");
      this.world = {
        ...this.world,
        units: this.world.units.map((item) =>
          item.id === command.unitId
            ? { ...item, destination, targetId: null }
            : item,
        ),
      };
    } else {
      const target = [...this.world.units, ...this.world.buildings].find(
        (item) => item.id === command.targetId,
      );
      if (!target || target.ownerId === playerId)
        throw new Error("Invalid enemy target");
      if (this.isProtected(target.ownerId, target.position, this.clock.nowMs()))
        throw new Error("Target has recovery protection");
      if (
        this.world.armies.some(
          (army) =>
            army.arrivesAtMs !== null && army.unitIds.includes(target.id),
        )
      )
        throw new Error("Target is travelling with an army");
      this.cancelProtection(playerId, this.clock.nowMs());
      this.world = {
        ...this.world,
        units: this.world.units.map((item) =>
          item.id === command.unitId
            ? { ...item, destination: null, targetId: target.id }
            : item,
        ),
      };
    }
  }

  advance(): WorldSnapshot {
    const now = this.clock.nowMs();
    const previousTime = this.world.lastSimulatedAtMs;
    this.settleEconomy(now);
    this.settleArmies(now);
    this.evaluateDefeats(now);
    this.settleRecovery(now);
    const deltaMs = Math.max(0, Math.min(now - previousTime, 1000));
    const original = new Map(
      [...this.world.units, ...this.world.buildings].map((item) => [
        item.id,
        item,
      ]),
    );
    const travelling = new Set(
      this.world.armies
        .filter((army) => army.arrivesAtMs !== null)
        .flatMap((army) => army.unitIds),
    );
    const moved: UnitView[] = this.world.units.map((unit) => {
      if (travelling.has(unit.id)) return unit;
      const stats = UNIT_STATS[unit.role];
      const target = unit.targetId ? original.get(unit.targetId) : undefined;
      let position = unit.position;
      let destination = unit.destination;
      let targetId = unit.targetId;
      if (
        target &&
        target.ownerId !== unit.ownerId &&
        !this.isProtected(target.ownerId, target.position, now)
      ) {
        const remaining = Math.max(
          0,
          distance(position, target.position) - stats.range * 0.9,
        );
        position = moveTowards(
          position,
          target.position,
          Math.min(remaining, (stats.speed * deltaMs) / 1000),
        );
      } else if (unit.targetId) {
        targetId = null;
      } else if (destination) {
        position = moveTowards(
          position,
          destination,
          (stats.speed * deltaMs) / 1000,
        );
        if (distance(position, destination) < 0.001) destination = null;
      }
      return {
        ...unit,
        position,
        destination,
        targetId,
        cooldownMs: Math.max(0, unit.cooldownMs - deltaMs),
      };
    });

    const byId = new Map(
      [...moved, ...this.world.buildings].map((item) => [item.id, item]),
    );
    const damage = new Map<string, number>();
    const rawEvents: Omit<CombatEvent, "destroyed">[] = [];
    const fired = new Set<string>();
    for (const unit of moved) {
      if (travelling.has(unit.id)) continue;
      if (!unit.targetId || unit.cooldownMs > 0 || deltaMs === 0) continue;
      const target = byId.get(unit.targetId);
      if (!target || target.ownerId === unit.ownerId) continue;
      if (this.isProtected(target.ownerId, target.position, now)) continue;
      if (travelling.has(target.id)) continue;
      const stats = UNIT_STATS[unit.role];
      if (distance(unit.position, target.position) > stats.range) continue;
      damage.set(target.id, (damage.get(target.id) ?? 0) + stats.damage);
      rawEvents.push({
        attackerId: unit.id,
        targetId: target.id,
        from: unit.position,
        to: target.position,
        damage: stats.damage,
      });
      fired.add(unit.id);
    }
    const damaged = moved.map((unit) => ({
      ...unit,
      health: Math.max(0, unit.health - (damage.get(unit.id) ?? 0)),
      cooldownMs: fired.has(unit.id)
        ? UNIT_STATS[unit.role].reloadMs
        : unit.cooldownMs,
    }));
    const damagedBuildings = this.world.buildings.map((building) => ({
      ...building,
      health: Math.max(0, building.health - (damage.get(building.id) ?? 0)),
    }));
    const survivingBuildings = damagedBuildings.filter(
      (building) => building.health > 0,
    );
    const alive = new Set([
      ...damaged.filter((unit) => unit.health > 0).map((unit) => unit.id),
      ...survivingBuildings.map((building) => building.id),
    ]);
    const combatEvents: CombatEvent[] = rawEvents.map((event) => ({
      ...event,
      destroyed: !alive.has(event.targetId),
    }));
    this.world = {
      ...this.world,
      tick: this.world.tick + 1,
      lastSimulatedAtMs: now,
      units: damaged
        .filter((unit) => unit.health > 0)
        .map((unit) =>
          unit.targetId && !alive.has(unit.targetId)
            ? { ...unit, targetId: null }
            : unit,
        ),
      armies: this.world.armies
        .map((army) => ({
          ...army,
          unitIds: army.unitIds.filter((id) => alive.has(id)),
        }))
        .filter((army) => army.unitIds.length > 0),
      buildings: survivingBuildings,
      production: this.world.production.filter((job) =>
        alive.has(job.factoryId),
      ),
      combatEvents,
    };
    this.updateTerritory();
    this.evaluateDefeats(now);
    return this.snapshot();
  }

  private createArmy(
    playerId: string,
    id: string,
    name: string,
    unitIds: readonly string[],
  ): void {
    if (!this.world.playerIds.includes(playerId))
      throw new Error("Player is not in match");
    if (this.world.armies.some((army) => army.id === id))
      throw new Error("Army already exists");
    if (new Set(unitIds).size !== unitIds.length)
      throw new Error("Duplicate unit in army");
    if (
      this.world.armies.some(
        (army) =>
          army.ownerId === playerId &&
          army.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("Army name already used");
    const members = unitIds.map((unitId) =>
      this.world.units.find((unit) => unit.id === unitId),
    );
    if (
      members.some((unit) => !unit || unit.ownerId !== playerId) ||
      this.world.armies.some((army) =>
        army.unitIds.some((unitId) => unitIds.includes(unitId)),
      )
    )
      throw new Error("Army units must be owned and unassigned");
    const origin = members[0]!.position;
    this.world = {
      ...this.world,
      armies: [
        ...this.world.armies,
        {
          id,
          ownerId: playerId,
          name,
          unitIds: [...unitIds],
          origin,
          destination: origin,
          stance: "defend",
          retreatThreshold: 25,
          postBattle: "hold",
          arrivesAtMs: null,
        },
      ],
    };
  }

  private orderArmy(
    playerId: string,
    armyId: string,
    destination: Point,
    stance: ArmyView["stance"],
    retreatThreshold: number,
    postBattle: ArmyView["postBattle"],
  ): void {
    if (
      Math.abs(destination.x) > WORLD_HALF_SIZE ||
      Math.abs(destination.z) > WORLD_HALF_SIZE
    )
      throw new Error("Destination outside map");
    const army = this.world.armies.find((item) => item.id === armyId);
    if (!army || army.ownerId !== playerId)
      throw new Error("Army is not owned by player");
    if (army.arrivesAtMs !== null)
      throw new Error("Army is already travelling");
    const members = this.world.units.filter((unit) =>
      army.unitIds.includes(unit.id),
    );
    if (members.length === 0) throw new Error("Army has no surviving units");
    const origin = members[0]!.position;
    const slowest = Math.min(
      ...members.map((unit) => UNIT_STATS[unit.role].speed),
    );
    const route = sectorRoute(origin, destination);
    const travelMs = Math.max(
      1000,
      Math.ceil(
        (((route.length - 1) * SECTOR_SIZE + distance(origin, destination)) /
          slowest) *
          2500,
      ),
    );
    if (stance === "attack")
      this.cancelProtection(playerId, this.clock.nowMs());
    this.world = {
      ...this.world,
      armies: this.world.armies.map((item) =>
        item.id === armyId
          ? {
              ...item,
              unitIds: members.map((unit) => unit.id),
              origin,
              destination,
              stance,
              retreatThreshold,
              postBattle,
              arrivesAtMs: this.clock.nowMs() + travelMs,
            }
          : item,
      ),
      units: this.world.units.map((unit) =>
        army.unitIds.includes(unit.id)
          ? { ...unit, destination: null, targetId: null }
          : unit,
      ),
    };
  }

  private settleArmies(now: number): void {
    for (let event = 0; event < 100; event++) {
      const army = this.world.armies
        .filter((item) => item.arrivesAtMs !== null && item.arrivesAtMs <= now)
        .sort(
          (a, b) => a.arrivesAtMs! - b.arrivesAtMs! || a.id.localeCompare(b.id),
        )[0];
      if (!army) break;
      const members = this.world.units.filter((unit) =>
        army.unitIds.includes(unit.id),
      );
      const arrival = army.arrivesAtMs!;
      if (members.length === 0) {
        this.world = {
          ...this.world,
          armies: this.world.armies.filter((item) => item.id !== army.id),
        };
        continue;
      }
      const arrivedUnits = this.world.units.map((unit) =>
        army.unitIds.includes(unit.id)
          ? {
              ...unit,
              position: army.destination,
              destination: null,
              targetId: null,
            }
          : unit,
      );
      this.world = {
        ...this.world,
        units: arrivedUnits,
        armies: this.world.armies.map((item) =>
          item.id === army.id ? { ...item, arrivesAtMs: null } : item,
        ),
      };
      this.updateTerritory();
      if (army.stance === "attack") this.resolveArmyBattle(army, arrival);
      else
        this.addReport({
          id: `${army.id}-${arrival}`,
          atMs: arrival,
          armyId: army.id,
          ownerId: army.ownerId,
          kind: "arrived",
          message: `${army.name} reached its defend position.`,
          ownLosses: 0,
          enemyLosses: 0,
        });
      this.evaluateDefeats(arrival);
    }
  }

  private updateTerritory(): void {
    this.world = {
      ...this.world,
      sectors: this.world.sectors.map((sector) => {
        const occupants = new Set(
          this.world.units
            .filter((unit) => sectorAt(unit.position) === sector.id)
            .map((unit) => unit.ownerId),
        );
        return occupants.size === 1
          ? { ...sector, ownerId: [...occupants][0]! }
          : sector;
      }),
    };
  }

  private resolveArmyBattle(army: ArmyView, atMs: number): void {
    const attackers = this.world.units.filter((unit) =>
      army.unitIds.includes(unit.id),
    );
    const travelling = new Set(
      this.world.armies
        .filter((item) => item.arrivesAtMs !== null)
        .flatMap((item) => item.unitIds),
    );
    const defenders = this.world.units.filter(
      (unit) =>
        unit.ownerId !== army.ownerId &&
        !travelling.has(unit.id) &&
        !this.isProtected(unit.ownerId, unit.position, atMs) &&
        distance(unit.position, army.destination) <= 10,
    );
    const defenderArmies = this.world.armies.filter(
      (item) =>
        item.ownerId !== army.ownerId &&
        item.arrivesAtMs === null &&
        item.unitIds.some((id) => defenders.some((unit) => unit.id === id)),
    );
    const initialAttackers = attackers.length;
    const initialDefenders = defenders.length;
    const hp = new Map(
      [...attackers, ...defenders].map((unit) => [unit.id, unit.health]),
    );
    const startingHp = attackers.reduce((sum, unit) => sum + unit.health, 0);
    let retreated = false;
    const withdrawn = new Set<string>();
    const retreatingDefenders = new Set<string>();
    for (
      let round = 0;
      round < 200 &&
      attackers.some((unit) => (hp.get(unit.id) ?? 0) > 0) &&
      defenders.some(
        (unit) => (hp.get(unit.id) ?? 0) > 0 && !withdrawn.has(unit.id),
      );
      round++
    ) {
      const liveAttackers = attackers.filter(
        (unit) => (hp.get(unit.id) ?? 0) > 0,
      );
      const liveDefenders = defenders.filter(
        (unit) => (hp.get(unit.id) ?? 0) > 0 && !withdrawn.has(unit.id),
      );
      const damage = new Map<string, number>();
      for (const [side, enemies] of [
        [liveAttackers, liveDefenders],
        [liveDefenders, liveAttackers],
      ] as const) {
        for (const unit of side) {
          const target = enemies[0];
          if (target)
            damage.set(
              target.id,
              (damage.get(target.id) ?? 0) + UNIT_STATS[unit.role].damage,
            );
        }
      }
      for (const [id, amount] of damage)
        hp.set(id, Math.max(0, (hp.get(id) ?? 0) - amount));
      for (const defenderArmy of defenderArmies) {
        if (retreatingDefenders.has(defenderArmy.id)) continue;
        const members = defenders.filter((unit) =>
          defenderArmy.unitIds.includes(unit.id),
        );
        const initial = members.reduce((sum, unit) => sum + unit.health, 0);
        const remaining = members.reduce(
          (sum, unit) => sum + (hp.get(unit.id) ?? 0),
          0,
        );
        if (
          remaining > 0 &&
          remaining * 100 <= initial * defenderArmy.retreatThreshold
        ) {
          retreatingDefenders.add(defenderArmy.id);
          for (const member of members) withdrawn.add(member.id);
        }
      }
      const remainingHp = attackers.reduce(
        (sum, unit) => sum + (hp.get(unit.id) ?? 0),
        0,
      );
      if (
        remainingHp > 0 &&
        remainingHp * 100 <= startingHp * army.retreatThreshold
      ) {
        retreated = true;
        break;
      }
    }
    const survivors = this.world.units
      .filter((unit) => !hp.has(unit.id) || (hp.get(unit.id) ?? 0) > 0)
      .map((unit) =>
        hp.has(unit.id)
          ? { ...unit, health: hp.get(unit.id)!, cooldownMs: 0 }
          : unit,
      );
    const ownLosses =
      initialAttackers -
      attackers.filter((unit) => (hp.get(unit.id) ?? 0) > 0).length;
    let enemyLosses =
      initialDefenders -
      defenders.filter((unit) => (hp.get(unit.id) ?? 0) > 0).length;
    const survivingIds = new Set(survivors.map((unit) => unit.id));
    const returnHome =
      retreated || (army.postBattle === "return" && survivingIds.size > 0);
    const remaining = attackers.filter((unit) => survivingIds.has(unit.id));
    const affectedOwners = new Set([
      ...defenders.map((unit) => unit.ownerId),
      ...this.world.buildings
        .filter(
          (building) =>
            building.ownerId !== army.ownerId &&
            distance(building.position, army.destination) <= 10 &&
            !this.isProtected(building.ownerId, building.position, atMs),
        )
        .map((building) => building.ownerId),
    ]);
    let buildings = [...this.world.buildings];
    if (remaining.length && !retreated) {
      let siegeDamage = remaining.reduce(
        (sum, unit) => sum + UNIT_STATS[unit.role].damage * 8,
        0,
      );
      buildings = buildings
        .map((building) => {
          if (
            building.ownerId === army.ownerId ||
            distance(building.position, army.destination) > 10 ||
            this.isProtected(building.ownerId, building.position, atMs) ||
            siegeDamage <= 0
          )
            return building;
          const applied = Math.min(building.health, siegeDamage);
          siegeDamage -= applied;
          if (applied >= building.health) enemyLosses += 1;
          return { ...building, health: building.health - applied };
        })
        .filter((building) => building.health > 0);
    }
    const travelMs = remaining.length
      ? Math.max(
          1000,
          Math.ceil(
            (distance(army.destination, army.origin) /
              Math.min(
                ...remaining.map((unit) => UNIT_STATS[unit.role].speed),
              )) *
              5000,
          ),
        )
      : 0;
    this.world = {
      ...this.world,
      units: survivors,
      buildings,
      production: this.world.production.filter((job) =>
        buildings.some((building) => building.id === job.factoryId),
      ),
      armies: this.world.armies
        .map((item) => {
          if (item.id === army.id)
            return {
              ...item,
              unitIds: remaining.map((unit) => unit.id),
              origin: army.destination,
              destination:
                returnHome && remaining.length ? army.origin : army.destination,
              stance: "defend" as const,
              arrivesAtMs:
                returnHome && remaining.length ? atMs + travelMs : null,
            };
          if (
            !defenderArmies.some((defenderArmy) => defenderArmy.id === item.id)
          )
            return item;
          const members = survivors.filter((unit) =>
            item.unitIds.includes(unit.id),
          );
          const shouldReturn =
            retreatingDefenders.has(item.id) || item.postBattle === "return";
          const home = item.origin;
          const current = item.destination;
          const duration = members.length
            ? Math.max(
                1000,
                Math.ceil(
                  (distance(current, home) /
                    Math.min(
                      ...members.map((unit) => UNIT_STATS[unit.role].speed),
                    )) *
                    5000,
                ),
              )
            : 0;
          return {
            ...item,
            unitIds: members.map((unit) => unit.id),
            origin: current,
            destination: shouldReturn ? home : current,
            arrivesAtMs:
              shouldReturn && members.length ? atMs + duration : null,
          };
        })
        .filter((item) => item.unitIds.length > 0),
    };
    this.addReport({
      id: `${army.id}-${atMs}`,
      atMs,
      armyId: army.id,
      ownerId: army.ownerId,
      kind:
        remaining.length === 0
          ? "destroyed"
          : retreated
            ? "retreated"
            : "battle",
      message: `${army.name} ${retreated ? "retreated from" : "reached"} the target. ${enemyLosses} enemy assets and ${ownLosses} allied units lost.${returnHome && remaining.length ? " Survivors returning." : ""}`,
      ownLosses,
      enemyLosses,
    });
    for (const ownerId of affectedOwners)
      this.addReport({
        id: `${army.id}-${atMs}-${ownerId}`,
        atMs,
        armyId: army.id,
        ownerId,
        kind: defenderArmies.some(
          (item) =>
            item.ownerId === ownerId && retreatingDefenders.has(item.id),
        )
          ? "retreated"
          : "battle",
        message: `${army.name} attacked your position. ${ownLosses} attackers and ${enemyLosses} defenders or structures lost.${defenderArmies.some((item) => item.ownerId === ownerId && retreatingDefenders.has(item.id)) ? " Your army retreated." : ""}`,
        ownLosses: enemyLosses,
        enemyLosses: ownLosses,
      });
  }

  private addReport(report: BattleReport): void {
    this.world = {
      ...this.world,
      battleReports: [...this.world.battleReports, report].slice(-100),
    };
  }

  private isProtected(
    playerId: string,
    position: Point,
    atMs: number,
  ): boolean {
    const recovery = this.world.recovery.find(
      (item) => item.playerId === playerId,
    );
    return (
      !!recovery?.protectionEndsAtMs &&
      recovery.protectionEndsAtMs > atMs &&
      distance(position, recovery.site) <= RECOVERY.protectionRadius
    );
  }

  private cancelProtection(playerId: string, atMs: number): void {
    const recovery = this.world.recovery.find(
      (item) => item.playerId === playerId,
    );
    if (!recovery?.protectionEndsAtMs || recovery.protectionEndsAtMs <= atMs)
      return;
    this.world = {
      ...this.world,
      recovery: this.world.recovery.map((item) =>
        item.playerId === playerId
          ? { ...item, protectionEndsAtMs: null }
          : item,
      ),
    };
    this.addReport({
      id: `protection-cancelled-${playerId}-${recovery.generation}`,
      atMs,
      armyId: `recovery-${playerId}`,
      ownerId: playerId,
      kind: "protection_ended",
      message: "Recovery protection ended when you issued an attack order.",
      ownLosses: 0,
      enemyLosses: 0,
    });
  }

  private chooseRecoverySite(playerId: string): Point {
    const candidates: Point[] = [
      { x: -16, z: -16 },
      { x: 16, z: 16 },
      { x: -16, z: 16 },
      { x: 16, z: -16 },
      { x: 0, z: -16 },
      { x: 0, z: 16 },
      { x: -16, z: 0 },
      { x: 16, z: 0 },
    ];
    const hazards = [
      ...this.world.units
        .filter((unit) => unit.ownerId !== playerId)
        .map((unit) => unit.position),
      ...this.world.buildings
        .filter((building) => building.ownerId !== playerId)
        .map((building) => building.position),
      ...this.world.recovery
        .filter((item) => item.playerId !== playerId)
        .map((item) => item.site),
    ];
    return candidates.reduce((best, candidate) => {
      const score = hazards.length
        ? Math.min(...hazards.map((point) => distance(candidate, point)))
        : 100;
      const bestScore = hazards.length
        ? Math.min(...hazards.map((point) => distance(best, point)))
        : 100;
      return score > bestScore ? candidate : best;
    });
  }

  private evaluateDefeats(atMs: number): void {
    for (const playerId of this.world.playerIds) {
      if (
        this.world.recovery.some(
          (item) => item.playerId === playerId && item.respawnAtMs !== null,
        )
      )
        continue;
      const hasUnits = this.world.units.some(
        (unit) => unit.ownerId === playerId,
      );
      const hasProduction = this.world.production.some(
        (job) => job.ownerId === playerId,
      );
      const ore =
        this.world.resources.find((item) => item.playerId === playerId)?.ore ??
        0;
      const hasEconomy = this.world.buildings.some(
        (building) =>
          building.ownerId === playerId &&
          (building.kind === "extractor" || ore >= ECONOMY.unitCost.scout),
      );
      if (hasUnits || hasProduction || hasEconomy) continue;
      const previous = this.world.recovery.find(
        (item) => item.playerId === playerId,
      );
      const generation = (previous?.generation ?? 0) + 1;
      const site = this.chooseRecoverySite(playerId);
      this.world = {
        ...this.world,
        recovery: [
          ...this.world.recovery.filter((item) => item.playerId !== playerId),
          {
            playerId,
            generation,
            site,
            respawnAtMs: atMs + RECOVERY.respawnDelayMs,
            protectionEndsAtMs: null,
          },
        ],
        armies: this.world.armies.filter((army) => army.ownerId !== playerId),
        buildings: this.world.buildings.filter(
          (building) => building.ownerId !== playerId,
        ),
        production: this.world.production.filter(
          (job) => job.ownerId !== playerId,
        ),
      };
      this.addReport({
        id: `recovery-scheduled-${playerId}-${generation}`,
        atMs,
        armyId: `recovery-${playerId}`,
        ownerId: playerId,
        kind: "recovery_scheduled",
        message: `Force destroyed. Recovery base scheduled at (${site.x}, ${site.z}) in ${RECOVERY.respawnDelayMs / 1000} seconds.`,
        ownLosses: 0,
        enemyLosses: 0,
      });
    }
  }

  private settleRecovery(now: number): void {
    for (const recovery of this.world.recovery.filter(
      (item) => item.respawnAtMs !== null && item.respawnAtMs <= now,
    )) {
      const atMs = recovery.respawnAtMs!;
      const playerId = recovery.playerId;
      const nodeId = `node-${playerId}`;
      const basePosition = recovery.site;
      this.world = {
        ...this.world,
        units: [
          ...this.world.units.filter((unit) => unit.ownerId !== playerId),
          makeUnit(
            `recovery-scout-${playerId}-${recovery.generation}`,
            playerId,
            "scout",
            { x: basePosition.x + 2, z: basePosition.z },
          ),
        ],
        buildings: [
          ...this.world.buildings.filter(
            (building) => building.ownerId !== playerId,
          ),
          {
            id: `extractor-${playerId}-recovery-${recovery.generation}`,
            ownerId: playerId,
            kind: "extractor" as const,
            position: basePosition,
            nodeId,
            readyAtMs: atMs,
            health: RECOVERY.buildingHealth.extractor,
            maxHealth: RECOVERY.buildingHealth.extractor,
          },
        ],
        resourceNodes: [
          ...this.world.resourceNodes.filter((node) => node.id !== nodeId),
          { id: nodeId, position: basePosition },
        ],
        resources: this.world.resources.map((balance) =>
          balance.playerId === playerId
            ? {
                ...balance,
                ore:
                  RECOVERY.startingOre +
                  (Math.max(0, now - atMs) * ECONOMY.orePerSecond) / 1000,
              }
            : balance,
        ),
        recovery: this.world.recovery.map((item) =>
          item.playerId === playerId
            ? {
                ...item,
                respawnAtMs: null,
                protectionEndsAtMs: atMs + RECOVERY.protectionMs,
              }
            : item,
        ),
      };
      this.addReport({
        id: `respawned-${playerId}-${recovery.generation}`,
        atMs,
        armyId: `recovery-${playerId}`,
        ownerId: playerId,
        kind: "respawned",
        message: `Recovery base established at (${basePosition.x}, ${basePosition.z}). One scout and extractor are ready. Protection lasts ${RECOVERY.protectionMs / 1000} seconds.`,
        ownLosses: 0,
        enemyLosses: 0,
      });
    }
    for (const recovery of this.world.recovery.filter(
      (item) =>
        item.protectionEndsAtMs !== null && item.protectionEndsAtMs <= now,
    )) {
      this.world = {
        ...this.world,
        recovery: this.world.recovery.map((item) =>
          item.playerId === recovery.playerId
            ? { ...item, protectionEndsAtMs: null }
            : item,
        ),
      };
      this.addReport({
        id: `protection-expired-${recovery.playerId}-${recovery.generation}`,
        atMs: recovery.protectionEndsAtMs!,
        armyId: `recovery-${recovery.playerId}`,
        ownerId: recovery.playerId,
        kind: "protection_ended",
        message: "Recovery protection expired.",
        ownLosses: 0,
        enemyLosses: 0,
      });
    }
  }

  private spend(playerId: string, cost: number): void {
    const balance = this.world.resources.find(
      (item) => item.playerId === playerId,
    );
    if (!balance || balance.ore < cost) throw new Error("Insufficient ore");
    this.world = {
      ...this.world,
      resources: this.world.resources.map((item) =>
        item.playerId === playerId ? { ...item, ore: item.ore - cost } : item,
      ),
    };
  }

  private build(
    playerId: string,
    kind: "extractor" | "factory",
    nodeId: string | null,
  ): void {
    if (!this.world.playerIds.includes(playerId))
      throw new Error("Player is not in match");
    const existing = this.world.buildings.find(
      (item) => item.ownerId === playerId && item.kind === kind,
    );
    if (existing) throw new Error("Building already exists");
    const node = this.world.resourceNodes.find((item) => item.id === nodeId);
    if (kind === "extractor" && (!node || node.id !== `node-${playerId}`))
      throw new Error("Invalid resource node");
    if (kind === "factory" && nodeId !== null)
      throw new Error("Factory does not use a node");
    this.spend(
      playerId,
      kind === "extractor" ? ECONOMY.extractorCost : ECONOMY.factoryCost,
    );
    const index = this.world.playerIds.indexOf(playerId);
    const recoverySite = this.world.recovery.find(
      (item) => item.playerId === playerId && item.respawnAtMs === null,
    )?.site;
    const position =
      kind === "extractor"
        ? node!.position
        : recoverySite
          ? {
              x: Math.min(WORLD_HALF_SIZE - 1, recoverySite.x + 3),
              z: Math.min(WORLD_HALF_SIZE - 1, recoverySite.z + 3),
            }
          : { x: index === 0 ? -12 : 12, z: 10 };
    this.world = {
      ...this.world,
      buildings: [
        ...this.world.buildings,
        {
          id: `${kind}-${playerId}`,
          ownerId: playerId,
          kind,
          position,
          nodeId: kind === "extractor" ? nodeId : null,
          readyAtMs:
            this.clock.nowMs() +
            (kind === "extractor"
              ? ECONOMY.extractorBuildMs
              : ECONOMY.factoryBuildMs),
          health: RECOVERY.buildingHealth[kind],
          maxHealth: RECOVERY.buildingHealth[kind],
        },
      ],
    };
  }

  private produce(
    playerId: string,
    factoryId: string,
    role: UnitRole,
    jobId: string,
  ): void {
    if (
      this.world.production.some((job) => job.id === jobId) ||
      this.world.units.some((unit) => unit.id === `produced-${jobId}`)
    )
      throw new Error("Production command already used");
    const factory = this.world.buildings.find(
      (item) =>
        item.id === factoryId &&
        item.ownerId === playerId &&
        item.kind === "factory",
    );
    if (!factory || factory.readyAtMs > this.clock.nowMs())
      throw new Error("Factory is not ready");
    if (this.world.production.some((job) => job.factoryId === factoryId))
      throw new Error("Factory is busy");
    this.spend(playerId, ECONOMY.unitCost[role]);
    this.world = {
      ...this.world,
      production: [
        ...this.world.production,
        {
          id: jobId,
          ownerId: playerId,
          role,
          factoryId,
          readyAtMs: this.clock.nowMs() + ECONOMY.unitBuildMs[role],
        },
      ],
    };
  }

  private settleEconomy(now: number): void {
    const from = this.world.lastSimulatedAtMs;
    if (now <= from) return;
    const resources = this.world.resources.map((balance) => {
      const extractor = this.world.buildings.find(
        (item) =>
          item.ownerId === balance.playerId && item.kind === "extractor",
      );
      const activeMs = extractor
        ? Math.max(0, now - Math.max(from, extractor.readyAtMs))
        : 0;
      return {
        ...balance,
        ore: balance.ore + (activeMs * ECONOMY.orePerSecond) / 1000,
      };
    });
    const completed = this.world.production.filter(
      (job) => job.readyAtMs <= now,
    );
    const units = [
      ...this.world.units,
      ...completed.map((job) => {
        const factory = this.world.buildings.find(
          (item) => item.id === job.factoryId,
        )!;
        return makeUnit(`produced-${job.id}`, job.ownerId, job.role, {
          x: factory.position.x,
          z: factory.position.z + 3,
        });
      }),
    ];
    this.world = {
      ...this.world,
      resources,
      units,
      production: this.world.production.filter((job) => job.readyAtMs > now),
      lastSimulatedAtMs: now,
    };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function moveTowards(
  position: Point,
  destination: Point,
  maxDistance: number,
): Point {
  const remaining = distance(position, destination);
  if (remaining <= maxDistance) return destination;
  if (remaining === 0) return position;
  return {
    x: position.x + ((destination.x - position.x) * maxDistance) / remaining,
    z: position.z + ((destination.z - position.z) * maxDistance) / remaining,
  };
}
