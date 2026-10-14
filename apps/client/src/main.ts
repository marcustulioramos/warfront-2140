import {
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import {
  protocolVersion,
  serverMessageSchema,
  type AttackUnitCommand,
  type BuildStructureCommand,
  type MoveUnitCommand,
  type ProduceUnitCommand,
  type CreateArmyCommand,
  type OrderArmyCommand,
} from "@warfront/protocol";
import {
  ECONOMY,
  RECOVERY,
  UNIT_STATS,
  WORLD_HALF_SIZE,
  type Point,
  type UnitRole,
  type WorldView,
} from "@warfront/shared";
import "./style.css";

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>("#battlefield");
const status = element<HTMLElement>("#status");
const selection = element<HTMLElement>("#selection");
const order = element<HTMLElement>("#order");
const coordinates = element<HTMLElement>("#coordinates");
const unitRoster = element<HTMLElement>("#unit-roster");
const combatLog = element<HTMLElement>("#combat-log");
const oreBalance = element<HTMLElement>("#ore-balance");
const economyProgress = element<HTMLElement>("#economy-progress");
const armyUnitList = element<HTMLElement>("#army-unit-list");
const armySelect = element<HTMLSelectElement>("#army-select");
const armyProgress = element<HTMLElement>("#army-progress");
const battleReports = element<HTMLElement>("#battle-reports");
const reconnectSummary = element<HTMLElement>("#reconnect-summary");
const buildExtractor = element<HTMLButtonElement>("#build-extractor");
const buildFactory = element<HTMLButtonElement>("#build-factory");
const produceButtons = {
  scout: element<HTMLButtonElement>("#produce-scout"),
  medium: element<HTMLButtonElement>("#produce-medium"),
  artillery: element<HTMLButtonElement>("#produce-artillery"),
};
const lobbyPanel = element<HTMLElement>("#lobby");
const lobbyMessage = element<HTMLElement>("#lobby-message");
const authForm = element<HTMLFormElement>("#auth-form");
const matchesPanel = element<HTMLElement>("#matches-panel");
const activeMatchPanel = element<HTMLElement>("#active-match");
const matchList = element<HTMLElement>("#match-list");
const hideTestMatches = element<HTMLInputElement>("#hide-test-matches");
const accountLabel = element<HTMLElement>("#account-label");
const matchLabel = element<HTMLElement>("#match-label");
const playerList = element<HTMLElement>("#player-list");
const recoveryStatus = element<HTMLElement>("#recovery-status");

interface Player {
  id: string;
  username: string;
}
interface Match {
  id: string;
  name: string;
  creatorId: string | null;
  players: (Player & { faction: string; colour: string })[];
}
let me: Player | undefined;
let activeMatch: Match | undefined;
let myPlayerId: string | undefined;
let reportsInitialized = false;
let armyUnitSignature = "";

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-Warfront-Request": "1",
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function faction(): string {
  return element<HTMLSelectElement>("#faction").value;
}
function showError(error: unknown): void {
  lobbyMessage.textContent =
    error instanceof Error ? error.message : "Something went wrong";
}

async function refreshLobby(): Promise<void> {
  const matches = await api<Match[]>("/matches");
  const visible = hideTestMatches.checked
    ? matches.filter((match) => !isAutomatedMatch(match))
    : matches;
  matchList.replaceChildren();
  for (const match of visible) {
    const row = document.createElement("div");
    row.className = "match-row";
    const details = document.createElement("span");
    details.textContent = `${match.name} · ${match.players.length}/2 players`;
    const button = document.createElement("button");
    button.textContent = match.players.some((player) => player.id === me?.id)
      ? "Rejoin"
      : "Join";
    button.disabled =
      match.players.length === 2 &&
      !match.players.some((player) => player.id === me?.id);
    button.addEventListener("click", () => {
      void (async () => {
        try {
          const joined = await api<Match>(`/matches/${match.id}/join`, "POST", {
            faction: faction(),
          });
          enterMatch(joined);
        } catch (error) {
          showError(error);
        }
      })();
    });
    const actions = document.createElement("div");
    actions.className = "match-actions";
    actions.append(button);
    if (match.creatorId === me?.id) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-match";
      remove.textContent = "Delete";
      remove.title = "Permanently delete this match for both players";
      remove.addEventListener("click", () => {
        if (
          !window.confirm(
            `Delete “${match.name}” and all its progress for both players?`,
          )
        )
          return;
        void api(`/matches/${match.id}`, "DELETE")
          .then(() => refreshLobby())
          .catch(showError);
      });
      actions.append(remove);
    }
    row.append(details, actions);
    matchList.append(row);
  }
  if (visible.length === 0)
    matchList.textContent =
      matches.length === 0
        ? "No matches yet. Create one above."
        : "Only automated test matches are hidden. Uncheck the filter to show them.";
}

function isAutomatedMatch(match: Match): boolean {
  const browser = /^Browser test ([0-9a-f]{10})$/.exec(match.name);
  const names = new Set(match.players.map((player) => player.username));
  if (browser)
    return names.has(`a${browser[1]}`) && names.has(`b${browser[1]}`);
  if (match.name !== "Two player smoke test" || match.players.length !== 2)
    return false;
  const alice = match.players.find((player) =>
    /^a[0-9a-f]{10}$/.test(player.username),
  );
  return !!alice && names.has(`b${alice.username.slice(1)}`);
}

hideTestMatches.addEventListener(
  "change",
  () => void refreshLobby().catch(showError),
);

function showLobby(): void {
  socket?.close();
  socket = undefined;
  activeMatch = undefined;
  myPlayerId = undefined;
  reportsInitialized = false;
  armyUnitSignature = "";
  armyUnitList.replaceChildren();
  armySelect.replaceChildren();
  selectedId = undefined;
  currentState = undefined;
  hasSnapshot = false;
  reportsInitialized = false;
  for (const mesh of units.values()) mesh.dispose();
  units.clear();
  selectionRing.setEnabled(false);
  destinationRing.setEnabled(false);
  recoveryRing.setEnabled(false);
  for (const bar of healthBars.values()) bar.dispose();
  healthBars.clear();
  targetPositions.clear();
  unitRoster.replaceChildren();
  unitButtons.clear();
  combatLog.textContent = "No combat yet.";
  recoveryStatus.textContent = "";
  lastCombatTick = -1;
  lobbyPanel.hidden = false;
  authForm.hidden = !!me;
  matchesPanel.hidden = !me;
  activeMatchPanel.hidden = true;
  accountLabel.textContent = me?.username ?? "";
  lobbyMessage.textContent = me
    ? "Create a match or join one."
    : "Sign in or create an account.";
  if (me) void refreshLobby().catch(showError);
}

function enterMatch(match: Match): void {
  activeMatch = match;
  lobbyPanel.hidden = true;
  activeMatchPanel.hidden = false;
  matchLabel.textContent = match.name;
  playerList.textContent = match.players
    .map((player) => `${player.username} (${player.colour}, ${player.faction})`)
    .join(" vs ");
  hasSnapshot = false;
  connect();
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const username = element<HTMLInputElement>("#username").value;
      const password = element<HTMLInputElement>("#password").value;
      me = await api<Player>("/login", "POST", { username, password });
      showLobby();
    } catch (error) {
      showError(error);
    }
  })();
});
element<HTMLButtonElement>("#register").addEventListener("click", () => {
  void (async () => {
    try {
      const username = element<HTMLInputElement>("#username").value;
      const password = element<HTMLInputElement>("#password").value;
      me = await api<Player>("/register", "POST", { username, password });
      showLobby();
    } catch (error) {
      showError(error);
    }
  })();
});
element<HTMLFormElement>("#create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const name = element<HTMLInputElement>("#match-name").value;
      enterMatch(
        await api<Match>("/matches", "POST", { name, faction: faction() }),
      );
    } catch (error) {
      showError(error);
    }
  })();
});
element<HTMLButtonElement>("#refresh-matches").addEventListener("click", () => {
  void refreshLobby().catch(showError);
});
element<HTMLButtonElement>("#logout").addEventListener("click", () => {
  void api("/logout", "POST")
    .then(() => {
      me = undefined;
      showLobby();
    })
    .catch(showError);
});
element<HTMLButtonElement>("#leave-match").addEventListener("click", showLobby);
void api<Player>("/me")
  .then((player) => {
    me = player;
    showLobby();
  })
  .catch(() => showLobby());

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor.set(0.035, 0.08, 0.12, 1);

const camera = new ArcRotateCamera(
  "camera",
  -Math.PI / 2,
  1.05,
  36,
  Vector3.Zero(),
  scene,
);
camera.lowerRadiusLimit = 10;
camera.upperRadiusLimit = 65;
camera.lowerBetaLimit = 0.35;
camera.upperBetaLimit = 1.45;
camera.panningSensibility = 85;
camera.attachControl(canvas, true);
new HemisphericLight("sun", new Vector3(0.6, 1, 0.3), scene);

const ground = MeshBuilder.CreateGround(
  "terrain",
  {
    width: WORLD_HALF_SIZE * 2,
    height: WORLD_HALF_SIZE * 2,
    subdivisions: 20,
  },
  scene,
);
const terrainMaterial = new StandardMaterial("terrain-material", scene);
terrainMaterial.diffuseColor = new Color3(0.14, 0.27, 0.23);
ground.material = terrainMaterial;

const road = MeshBuilder.CreateGround(
  "road",
  { width: 3, height: WORLD_HALF_SIZE * 2 },
  scene,
);
road.position.y = 0.015;
road.isPickable = false;
const roadMaterial = new StandardMaterial("road-material", scene);
roadMaterial.diffuseColor = new Color3(0.27, 0.31, 0.31);
road.material = roadMaterial;

for (
  let coordinate = -WORLD_HALF_SIZE;
  coordinate <= WORLD_HALF_SIZE;
  coordinate += 5
) {
  const vertical = MeshBuilder.CreateLines(
    `grid-vertical-${coordinate}`,
    {
      points: [
        new Vector3(coordinate, 0.025, -WORLD_HALF_SIZE),
        new Vector3(coordinate, 0.025, WORLD_HALF_SIZE),
      ],
    },
    scene,
  );
  const horizontal = MeshBuilder.CreateLines(
    `grid-horizontal-${coordinate}`,
    {
      points: [
        new Vector3(-WORLD_HALF_SIZE, 0.025, coordinate),
        new Vector3(WORLD_HALF_SIZE, 0.025, coordinate),
      ],
    },
    scene,
  );
  vertical.color = horizontal.color = new Color3(0.22, 0.37, 0.35);
  vertical.isPickable = horizontal.isPickable = false;
}

for (const [x, z] of [
  [-22, -14],
  [-23, 12],
  [23, -10],
  [22, 15],
] as const) {
  const ridge = MeshBuilder.CreateCylinder(
    `ridge-${x}-${z}`,
    {
      diameterTop: 1,
      diameterBottom: 8,
      height: 5,
      tessellation: 7,
    },
    scene,
  );
  ridge.position.set(x, 1.7, z);
  ridge.isPickable = false;
  const material = new StandardMaterial(`ridge-material-${x}-${z}`, scene);
  material.diffuseColor = new Color3(0.19, 0.24, 0.23);
  ridge.material = material;
}

const units = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const structures = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const healthBars = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const targetPositions = new Map<string, Vector3>();
const unitButtons = new Map<string, HTMLButtonElement>();
function unitMesh(
  id: string,
  owned: boolean,
  role: UnitRole,
): ReturnType<typeof MeshBuilder.CreateBox> {
  let mesh = units.get(id);
  if (!mesh) {
    mesh =
      role === "artillery"
        ? MeshBuilder.CreateCylinder(
            id,
            { diameter: 1.8, height: 1.2, tessellation: 8 },
            scene,
          )
        : MeshBuilder.CreateBox(
            id,
            role === "medium"
              ? { width: 2.2, depth: 2.8, height: 1.1 }
              : { width: 1.4, depth: 2, height: 0.7 },
            scene,
          );
    mesh.position.y = 0.6;
    const material = new StandardMaterial(`material-${id}`, scene);
    material.diffuseColor = owned
      ? new Color3(0.08, 0.45, 0.9)
      : new Color3(0.95, 0.38, 0.12);
    mesh.material = material;
    units.set(id, mesh);
    const bar = MeshBuilder.CreateBox(
      `health-${id}`,
      { width: 1.8, depth: 0.15, height: 0.1 },
      scene,
    );
    bar.isPickable = false;
    const barMaterial = new StandardMaterial(`health-material-${id}`, scene);
    barMaterial.emissiveColor = new Color3(0.25, 0.95, 0.45);
    bar.material = barMaterial;
    healthBars.set(id, bar);
  }
  return mesh;
}

const selectionRing = MeshBuilder.CreateTorus(
  "selection-ring",
  { diameter: 3.4, thickness: 0.1 },
  scene,
);
selectionRing.rotation.x = Math.PI / 2;
selectionRing.position.y = 0.12;
selectionRing.isPickable = false;
selectionRing.setEnabled(false);
const selectionMaterial = new StandardMaterial("selection-material", scene);
selectionMaterial.emissiveColor = new Color3(0.2, 0.9, 0.8);
selectionRing.material = selectionMaterial;

const destinationRing = MeshBuilder.CreateTorus(
  "destination-ring",
  { diameter: 1.5, thickness: 0.08 },
  scene,
);
destinationRing.rotation.x = Math.PI / 2;
destinationRing.position.y = 0.12;
destinationRing.isPickable = false;
destinationRing.setEnabled(false);
const destinationMaterial = new StandardMaterial("destination-material", scene);
destinationMaterial.emissiveColor = new Color3(1, 0.7, 0.2);
destinationRing.material = destinationMaterial;

const recoveryRing = MeshBuilder.CreateTorus(
  "recovery-zone-ring",
  {
    diameter: RECOVERY.protectionRadius * 2,
    thickness: 0.12,
    tessellation: 64,
  },
  scene,
);
recoveryRing.rotation.x = Math.PI / 2;
recoveryRing.position.y = 0.14;
recoveryRing.isPickable = false;
recoveryRing.setEnabled(false);
const recoveryMaterial = new StandardMaterial("recovery-zone-material", scene);
recoveryMaterial.emissiveColor = new Color3(0.15, 0.85, 1);
recoveryRing.material = recoveryMaterial;

let socket: WebSocket | undefined;
let currentState: WorldView | undefined;
let hasSnapshot = false;
let selectedId: string | undefined;
let lastCombatTick = -1;
const keys = new Set<string>();

function roleName(role: UnitRole): string {
  return role === "medium"
    ? "Medium Assault"
    : role === "artillery"
      ? "Artillery"
      : "Scout";
}

function setSelection(id: string | undefined): void {
  selectedId = id;
  selectionRing.setEnabled(!!id);
  const unit = currentState?.units.find((item) => item.id === id);
  selection.textContent = unit
    ? `${roleName(unit.role)} selected — ${unit.health}/${unit.maxHealth} HP · ${UNIT_STATS[unit.role].weapon}.`
    : "Select one of your blue units.";
}

function showState(state: WorldView & { lastSimulatedAtMs: number }): void {
  const previous = currentState;
  currentState = state;
  const serverNow = state.lastSimulatedAtMs;
  const recovery = state.recovery.find((item) => item.playerId === myPlayerId);
  const recoveryPending = !!recovery?.respawnAtMs;
  recoveryStatus.textContent = recovery?.respawnAtMs
    ? `Recovery in ${Math.max(0, Math.ceil((recovery.respawnAtMs - serverNow) / 1000))}s at (${recovery.site.x}, ${recovery.site.z})`
    : recovery?.protectionEndsAtMs && recovery.protectionEndsAtMs > serverNow
      ? `Protected near (${recovery.site.x}, ${recovery.site.z}), radius ${RECOVERY.protectionRadius} · ${Math.ceil((recovery.protectionEndsAtMs - serverNow) / 1000)}s`
      : "";
  const showRecoveryZone =
    !!recovery &&
    (recovery.respawnAtMs !== null ||
      (recovery.protectionEndsAtMs !== null &&
        recovery.protectionEndsAtMs > serverNow));
  recoveryRing.setEnabled(showRecoveryZone);
  if (showRecoveryZone && recovery) {
    recoveryRing.position.x = recovery.site.x;
    recoveryRing.position.z = recovery.site.z;
    recoveryMaterial.emissiveColor =
      recovery.respawnAtMs !== null
        ? new Color3(1, 0.65, 0.15)
        : new Color3(0.15, 0.85, 1);
  }
  const balance =
    state.resources.find((item) => item.playerId === myPlayerId)?.ore ?? 0;
  oreBalance.textContent = `Ore: ${Math.floor(balance)} · +${ECONOMY.orePerSecond}/sec per extractor`;
  const extractor = state.buildings.find(
    (item) => item.ownerId === myPlayerId && item.kind === "extractor",
  );
  const factory = state.buildings.find(
    (item) => item.ownerId === myPlayerId && item.kind === "factory",
  );
  buildExtractor.disabled =
    !myPlayerId ||
    recoveryPending ||
    !!extractor ||
    balance < ECONOMY.extractorCost;
  buildFactory.disabled =
    !myPlayerId ||
    recoveryPending ||
    !!factory ||
    balance < ECONOMY.factoryCost;
  const factoryReady = !!factory && factory.readyAtMs <= serverNow;
  const job = state.production.find((item) => item.ownerId === myPlayerId);
  for (const role of ["scout", "medium", "artillery"] as const) {
    produceButtons[role].disabled =
      !factoryReady || !!job || balance < ECONOMY.unitCost[role];
  }
  const tasks = [
    ...(extractor && extractor.readyAtMs > serverNow
      ? [`Extractor: ${Math.ceil((extractor.readyAtMs - serverNow) / 1000)}s`]
      : []),
    ...(factory && factory.readyAtMs > serverNow
      ? [`Factory: ${Math.ceil((factory.readyAtMs - serverNow) / 1000)}s`]
      : []),
    ...(job
      ? [
          `${roleName(job.role)}: ${Math.ceil((job.readyAtMs - serverNow) / 1000)}s`,
        ]
      : []),
  ];
  economyProgress.textContent = tasks.length
    ? tasks.join(" · ")
    : "Build an extractor, then a factory to produce units.";
  const visibleStructures = new Set([
    ...state.resourceNodes.map((node) => `node-mesh-${node.id}`),
    ...state.buildings.map((building) => building.id),
  ]);
  for (const [id, mesh] of structures) {
    if (visibleStructures.has(id)) continue;
    mesh.dispose();
    structures.delete(id);
  }
  for (const node of state.resourceNodes) {
    const id = `node-mesh-${node.id}`;
    if (!structures.has(id)) {
      const mesh = MeshBuilder.CreateSphere(id, { diameter: 1.7 }, scene);
      mesh.position.set(node.position.x, 0.5, node.position.z);
      mesh.isPickable = false;
      const material = new StandardMaterial(id, scene);
      material.emissiveColor = new Color3(0.2, 0.75, 0.9);
      mesh.material = material;
      structures.set(id, mesh);
    }
  }
  for (const building of state.buildings) {
    if (!structures.has(building.id)) {
      const mesh = MeshBuilder.CreateBox(
        building.id,
        { width: 3, depth: 3, height: building.kind === "factory" ? 2.2 : 1.5 },
        scene,
      );
      mesh.position.set(
        building.position.x,
        building.kind === "factory" ? 1.1 : 0.75,
        building.position.z,
      );
      mesh.isPickable = true;
      const material = new StandardMaterial(`building-${building.id}`, scene);
      material.diffuseColor =
        building.ownerId === myPlayerId
          ? new Color3(0.15, 0.55, 0.85)
          : new Color3(0.8, 0.35, 0.2);
      mesh.material = material;
      structures.set(building.id, mesh);
    }
    structures.get(building.id)!.scaling.y =
      building.readyAtMs > serverNow ? 0.4 : 1;
    const material = structures.get(building.id)!.material as StandardMaterial;
    material.emissiveColor =
      building.health / building.maxHealth < 0.35
        ? new Color3(0.6, 0.08, 0.05)
        : Color3.Black();
  }
  if (
    activeMatch &&
    state.units.some(
      (unit) =>
        !activeMatch?.players.some((player) => player.id === unit.ownerId),
    )
  ) {
    const currentId = activeMatch.id;
    void api<Match[]>("/matches")
      .then((matches) => {
        const updated = matches.find((match) => match.id === currentId);
        if (updated && activeMatch?.id === currentId) {
          activeMatch = updated;
          playerList.textContent = updated.players
            .map(
              (player) =>
                `${player.username} (${player.colour}, ${player.faction})`,
            )
            .join(" vs ");
        }
      })
      .catch(() => undefined);
  }
  const visibleIds = new Set(state.units.map((unit) => unit.id));
  for (const [id, mesh] of units) {
    if (visibleIds.has(id)) continue;
    mesh.dispose();
    units.delete(id);
    healthBars.get(id)?.dispose();
    healthBars.delete(id);
    targetPositions.delete(id);
  }
  for (const unit of state.units) {
    const mesh = unitMesh(unit.id, unit.ownerId === myPlayerId, unit.role);
    const target = new Vector3(unit.position.x, 0.6, unit.position.z);
    targetPositions.set(unit.id, target);
    if (!hasSnapshot) mesh.position.copyFrom(target);
    const bar = healthBars.get(unit.id);
    if (bar) {
      bar.scaling.x = unit.health / unit.maxHealth;
      const material = bar.material as StandardMaterial;
      material.emissiveColor =
        unit.health / unit.maxHealth < 0.35
          ? new Color3(1, 0.2, 0.15)
          : new Color3(0.25, 0.95, 0.45);
    }
  }
  hasSnapshot = true;
  if (selectedId && !visibleIds.has(selectedId)) setSelection(undefined);
  const owned = state.units.filter((unit) => unit.ownerId === myPlayerId);
  const assigned = new Set(state.armies.flatMap((army) => army.unitIds));
  const available = owned.filter((unit) => !assigned.has(unit.id));
  const signature = available.map((unit) => unit.id).join("|");
  if (signature !== armyUnitSignature) {
    armyUnitSignature = signature;
    armyUnitList.replaceChildren();
    for (const unit of available) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = unit.id;
      label.append(checkbox, ` ${roleName(unit.role)}`);
      armyUnitList.append(label);
    }
  }
  const ownArmies = state.armies.filter((army) => army.ownerId === myPlayerId);
  const selectedArmy = armySelect.value;
  if (
    armySelect.options.length !== ownArmies.length ||
    ownArmies.some(
      (army, index) => armySelect.options[index]?.value !== army.id,
    )
  ) {
    armySelect.replaceChildren(
      ...ownArmies.map((army) => {
        const option = document.createElement("option");
        option.value = army.id;
        option.textContent = army.name;
        return option;
      }),
    );
    armySelect.value = ownArmies.some((army) => army.id === selectedArmy)
      ? selectedArmy
      : (ownArmies[0]?.id ?? "");
  }
  armyProgress.textContent = ownArmies.length
    ? ownArmies
        .map(
          (army) =>
            `${army.name}: ${army.arrivesAtMs === null ? `holding (${army.unitIds.length} units)` : `travelling · ${Math.max(0, Math.ceil((army.arrivesAtMs - serverNow) / 1000))}s remaining`}`,
        )
        .join(" · ")
    : "No army orders yet.";
  const reports = state.battleReports.filter(
    (report) => report.ownerId === myPlayerId,
  );
  battleReports.replaceChildren(
    ...reports
      .slice(-6)
      .reverse()
      .map((report) => {
        const item = document.createElement("li");
        item.textContent = `${new Date(report.atMs).toLocaleString()}: ${report.message}`;
        return item;
      }),
  );
  if (!reportsInitialized && activeMatch && myPlayerId) {
    const key = `warfront-reports-${activeMatch.id}-${myPlayerId}`;
    const lastVisit = Number(localStorage.getItem(key) ?? 0);
    const newReports = reports.filter((report) => report.atMs > lastVisit);
    reconnectSummary.textContent =
      lastVisit && newReports.length
        ? `${newReports.length} new report${newReports.length === 1 ? "" : "s"} since your last visit.`
        : "";
    reportsInitialized = true;
  }
  if (activeMatch && myPlayerId)
    localStorage.setItem(
      `warfront-reports-${activeMatch.id}-${myPlayerId}`,
      String(serverNow),
    );
  const ownedIds = new Set(owned.map((unit) => unit.id));
  for (const [id, button] of unitButtons) {
    if (ownedIds.has(id)) continue;
    button.remove();
    unitButtons.delete(id);
  }
  for (const unit of owned) {
    let button = unitButtons.get(unit.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => setSelection(unit.id));
      unitButtons.set(unit.id, button);
      unitRoster.append(button);
    }
    button.textContent = `${roleName(unit.role)} · ${unit.health}/${unit.maxHealth} HP`;
    button.title = `${UNIT_STATS[unit.role].weapon}: ${UNIT_STATS[unit.role].damage} damage, ${UNIT_STATS[unit.role].range} range`;
    button.className = selectedId === unit.id ? "unit-active" : "";
  }
  if (owned.length === 0) unitRoster.textContent = "All units destroyed.";
  const focused = owned.find((unit) => unit.id === selectedId) ?? owned[0];
  if (!focused) {
    coordinates.textContent = `Server tick ${state.tick}`;
    order.textContent = "No surviving units.";
    destinationRing.setEnabled(false);
  } else {
    coordinates.textContent = `Position: ${focused.position.x.toFixed(1)}, ${focused.position.z.toFixed(1)} · Server tick ${state.tick}`;
    destinationRing.setEnabled(focused.destination !== null);
    if (focused.destination) {
      destinationRing.position.set(
        focused.destination.x,
        0.12,
        focused.destination.z,
      );
      order.textContent = `Moving to ${focused.destination.x.toFixed(1)}, ${focused.destination.z.toFixed(1)}`;
    } else if (focused.targetId) {
      order.textContent = `Attacking ${state.units.find((unit) => unit.id === focused.targetId)?.role ?? state.buildings.find((building) => building.id === focused.targetId)?.kind ?? "enemy"}.`;
    } else {
      order.textContent = "Holding position.";
    }
  }
  if (state.tick > lastCombatTick) {
    lastCombatTick = state.tick;
    for (const event of state.combatEvents) {
      const beam = MeshBuilder.CreateLines(
        `shot-${state.tick}-${event.attackerId}`,
        {
          points: [
            new Vector3(event.from.x, 1.1, event.from.z),
            new Vector3(event.to.x, 1.1, event.to.z),
          ],
        },
        scene,
      );
      beam.color = new Color3(1, 0.8, 0.25);
      beam.isPickable = false;
      window.setTimeout(() => beam.dispose(), 220);
      if (event.destroyed) {
        const burst = MeshBuilder.CreateSphere(
          `burst-${state.tick}-${event.targetId}`,
          { diameter: 2.3 },
          scene,
        );
        burst.position.set(event.to.x, 1, event.to.z);
        burst.isPickable = false;
        const burstMaterial = new StandardMaterial(
          `burst-material-${state.tick}-${event.targetId}`,
          scene,
        );
        burstMaterial.emissiveColor = new Color3(1, 0.35, 0.05);
        burst.material = burstMaterial;
        window.setTimeout(() => {
          burst.dispose();
          burstMaterial.dispose();
        }, 300);
      }
      const attacker = previous?.units.find(
        (unit) => unit.id === event.attackerId,
      );
      const target = previous?.units.find((unit) => unit.id === event.targetId);
      const targetBuilding = previous?.buildings.find(
        (building) => building.id === event.targetId,
      );
      combatLog.textContent = `${attacker ? roleName(attacker.role) : "Unit"} hit ${target ? roleName(target.role) : (targetBuilding?.kind ?? "enemy")} for ${event.damage}${event.destroyed ? " — destroyed!" : ""}`;
    }
  }
}

function commandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sendMove(destination: Point): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !currentState) {
    status.textContent = "Waiting for the server before issuing orders.";
    return;
  }
  const command: MoveUnitCommand = {
    protocolVersion,
    commandId: commandId(),
    type: "MOVE_UNIT",
    unitId: selectedId ?? "",
    destination,
  };
  socket.send(JSON.stringify(command));
  status.textContent = "Move order sent. Waiting for server confirmation…";
}

function sendAttack(targetId: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN || !selectedId) {
    status.textContent = "Select one of your units before attacking.";
    return;
  }
  const command: AttackUnitCommand = {
    protocolVersion,
    commandId: commandId(),
    type: "ATTACK_UNIT",
    unitId: selectedId,
    targetId,
  };
  socket.send(JSON.stringify(command));
  status.textContent = "Attack order sent. Waiting for server confirmation…";
}

function sendEconomy(
  command: BuildStructureCommand | ProduceUnitCommand,
): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(command));
  status.textContent = "Economy order sent. Waiting for server confirmation…";
}
function sendArmy(command: CreateArmyCommand | OrderArmyCommand): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(command));
  status.textContent = "Army order sent. Waiting for server confirmation…";
}
element<HTMLFormElement>("#create-army-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const unitIds = Array.from(
      armyUnitList.querySelectorAll<HTMLInputElement>("input:checked"),
      (input) => input.value,
    );
    if (!unitIds.length) {
      status.textContent = "Choose at least one available unit.";
      return;
    }
    sendArmy({
      protocolVersion,
      commandId: commandId(),
      type: "CREATE_ARMY",
      name: element<HTMLInputElement>("#army-name").value.trim(),
      unitIds,
    });
  },
);
element<HTMLFormElement>("#order-army-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    if (!armySelect.value) {
      status.textContent = "Create an army first.";
      return;
    }
    sendArmy({
      protocolVersion,
      commandId: commandId(),
      type: "ORDER_ARMY",
      armyId: armySelect.value,
      destination: {
        x: Number(element<HTMLInputElement>("#army-x").value),
        z: Number(element<HTMLInputElement>("#army-z").value),
      },
      stance: element<HTMLSelectElement>("#army-stance").value as
        "attack" | "defend",
      retreatThreshold: Number(
        element<HTMLInputElement>("#army-retreat").value,
      ),
      postBattle: element<HTMLSelectElement>("#army-post-battle").value as
        "hold" | "return",
    });
  },
);
for (const [button, kind] of [
  [buildExtractor, "extractor"],
  [buildFactory, "factory"],
] as const) {
  button.addEventListener("click", () => {
    const command: BuildStructureCommand = {
      protocolVersion,
      commandId: commandId(),
      type: "BUILD_STRUCTURE",
      kind,
      nodeId:
        kind === "extractor"
          ? (currentState?.resourceNodes.find(
              (node) => node.id === `node-${myPlayerId}`,
            )?.id ?? null)
          : null,
    };
    sendEconomy(command);
  });
}
for (const role of ["scout", "medium", "artillery"] as const) {
  produceButtons[role].addEventListener("click", () => {
    const command: ProduceUnitCommand = {
      protocolVersion,
      commandId: commandId(),
      type: "PRODUCE_UNIT",
      role,
      factoryId: `factory-${myPlayerId}`,
    };
    sendEconomy(command);
  });
}

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
scene.onPointerDown = (event, pick) => {
  if (event.button === 0) {
    const owned = [...units.entries()].find(
      ([id, mesh]) =>
        mesh === pick?.pickedMesh &&
        currentState?.units.some(
          (item) => item.id === id && item.ownerId === myPlayerId,
        ),
    );
    setSelection(owned?.[0]);
  } else if (event.button === 2 && selectedId) {
    const enemy = [...units.entries()].find(
      ([id, mesh]) =>
        mesh === pick?.pickedMesh &&
        currentState?.units.some(
          (unit) => unit.id === id && unit.ownerId !== myPlayerId,
        ),
    );
    if (enemy) {
      sendAttack(enemy[0]);
      return;
    }
    const enemyBuilding = [...structures.entries()].find(
      ([id, mesh]) =>
        mesh === pick?.pickedMesh &&
        currentState?.buildings.some(
          (building) => building.id === id && building.ownerId !== myPlayerId,
        ),
    );
    if (enemyBuilding) {
      sendAttack(enemyBuilding[0]);
      return;
    }
    const terrainPick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (mesh) => mesh === ground,
    );
    if (terrainPick?.hit && terrainPick.pickedPoint) {
      sendMove({ x: terrainPick.pickedPoint.x, z: terrainPick.pickedPoint.z });
    }
  }
};

function connect(): void {
  if (!activeMatch) return;
  const connectingMatchId = activeMatch.id;
  const connection = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?matchId=${encodeURIComponent(connectingMatchId)}`,
  );
  socket = connection;
  connection.onopen = () => {
    status.textContent = "Connected to the authoritative server.";
  };
  connection.onclose = (event) => {
    if (socket !== connection) return;
    if (event.code === 1008) {
      status.textContent = "Match closed or access ended.";
      showLobby();
      return;
    }
    status.textContent = "Connection lost. Reconnecting…";
    if (activeMatch?.id === connectingMatchId) window.setTimeout(connect, 2000);
  };
  connection.onmessage = (event: MessageEvent<string>) => {
    try {
      const message = serverMessageSchema.parse(
        JSON.parse(event.data) as unknown,
      );
      if (message.type === "SNAPSHOT") showState(message.state);
      else if (message.type === "WELCOME") myPlayerId = message.playerId;
      else if (message.type === "ACK")
        status.textContent = "Order accepted by the server.";
      else status.textContent = `Order rejected: ${message.message}`;
    } catch {
      status.textContent = "Received an invalid server message.";
    }
  };
}

window.addEventListener("keydown", (event) => {
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
    ].includes(event.code)
  ) {
    keys.add(event.code);
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});
window.addEventListener("blur", () => keys.clear());

engine.runRenderLoop(() => {
  const delta = Math.min(engine.getDeltaTime() / 1000, 0.1);
  const pan = delta * 14;
  if (keys.has("KeyW") || keys.has("ArrowUp")) camera.target.z += pan;
  if (keys.has("KeyS") || keys.has("ArrowDown")) camera.target.z -= pan;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) camera.target.x -= pan;
  if (keys.has("KeyD") || keys.has("ArrowRight")) camera.target.x += pan;
  camera.target.x = Math.max(
    -WORLD_HALF_SIZE,
    Math.min(WORLD_HALF_SIZE, camera.target.x),
  );
  camera.target.z = Math.max(
    -WORLD_HALF_SIZE,
    Math.min(WORLD_HALF_SIZE, camera.target.z),
  );
  for (const [id, mesh] of units) {
    const target = targetPositions.get(id);
    if (target)
      mesh.position.copyFrom(
        Vector3.Lerp(mesh.position, target, Math.min(1, delta * 12)),
      );
    const bar = healthBars.get(id);
    if (bar) {
      bar.position.set(
        mesh.position.x - (1 - bar.scaling.x) * 0.9,
        1.55,
        mesh.position.z,
      );
    }
  }
  const selectedMesh = selectedId ? units.get(selectedId) : undefined;
  if (selectedMesh)
    selectionRing.position.set(
      selectedMesh.position.x,
      0.12,
      selectedMesh.position.z,
    );
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
