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
  type MoveUnitCommand,
} from "@warfront/protocol";
import { WORLD_HALF_SIZE, type Point, type WorldView } from "@warfront/shared";
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
const lobbyPanel = element<HTMLElement>("#lobby");
const lobbyMessage = element<HTMLElement>("#lobby-message");
const authForm = element<HTMLFormElement>("#auth-form");
const matchesPanel = element<HTMLElement>("#matches-panel");
const activeMatchPanel = element<HTMLElement>("#active-match");
const matchList = element<HTMLElement>("#match-list");
const accountLabel = element<HTMLElement>("#account-label");
const matchLabel = element<HTMLElement>("#match-label");
const playerList = element<HTMLElement>("#player-list");

interface Player {
  id: string;
  username: string;
}
interface Match {
  id: string;
  name: string;
  players: (Player & { faction: string; colour: string })[];
}
let me: Player | undefined;
let activeMatch: Match | undefined;
let myPlayerId: string | undefined;

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Warfront-Request": "1" },
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
  matchList.replaceChildren();
  for (const match of matches) {
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
    row.append(details, button);
    matchList.append(row);
  }
  if (matches.length === 0)
    matchList.textContent = "No matches yet. Create one above.";
}

function showLobby(): void {
  socket?.close();
  socket = undefined;
  activeMatch = undefined;
  myPlayerId = undefined;
  selectedId = undefined;
  currentState = undefined;
  hasSnapshot = false;
  for (const mesh of units.values()) mesh.dispose();
  units.clear();
  selectionRing.setEnabled(false);
  destinationRing.setEnabled(false);
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
const targetPositions = new Map<string, Vector3>();
function unitMesh(
  id: string,
  owned: boolean,
): ReturnType<typeof MeshBuilder.CreateBox> {
  let mesh = units.get(id);
  if (!mesh) {
    mesh = MeshBuilder.CreateBox(
      id,
      { width: 1.7, depth: 2.4, height: 1 },
      scene,
    );
    mesh.position.y = 0.6;
    const material = new StandardMaterial(`material-${id}`, scene);
    material.diffuseColor = owned
      ? new Color3(0.08, 0.45, 0.9)
      : new Color3(0.95, 0.38, 0.12);
    mesh.material = material;
    units.set(id, mesh);
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

let socket: WebSocket | undefined;
let currentState: WorldView | undefined;
let hasSnapshot = false;
let selectedId: string | undefined;
const keys = new Set<string>();

function setSelection(id: string | undefined): void {
  selectedId = id;
  selectionRing.setEnabled(!!id);
  selection.textContent = id
    ? "Scout selected — ready for orders."
    : "Select your blue scout.";
}

function showState(state: WorldView): void {
  currentState = state;
  if (activeMatch && state.units.length !== activeMatch.players.length) {
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
  for (const scout of state.units) {
    const mesh = unitMesh(scout.id, scout.ownerId === myPlayerId);
    const target = new Vector3(scout.position.x, 0.6, scout.position.z);
    targetPositions.set(scout.id, target);
    if (!hasSnapshot) mesh.position.copyFrom(target);
  }
  hasSnapshot = true;
  const scout = state.units.find((item) => item.ownerId === myPlayerId);
  if (!scout) return;
  coordinates.textContent = `Position: ${scout.position.x.toFixed(1)}, ${scout.position.z.toFixed(1)} · Server tick ${state.tick}`;
  destinationRing.setEnabled(scout.destination !== null);
  if (scout.destination) {
    destinationRing.position.set(
      scout.destination.x,
      0.12,
      scout.destination.z,
    );
    order.textContent = `Moving to ${scout.destination.x.toFixed(1)}, ${scout.destination.z.toFixed(1)}`;
  } else {
    order.textContent = "Holding position.";
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
  connection.onclose = () => {
    if (socket !== connection) return;
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
        status.textContent = "Move order accepted by the server.";
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
