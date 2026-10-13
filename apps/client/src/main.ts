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

const unit = MeshBuilder.CreateBox(
  "scout-unit",
  { width: 1.7, depth: 2.4, height: 1 },
  scene,
);
unit.position.y = 0.6;
const unitMaterial = new StandardMaterial("unit-blue", scene);
unitMaterial.diffuseColor = new Color3(0.08, 0.45, 0.9);
unit.material = unitMaterial;

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
let targetPosition = unit.position.clone();
let hasSnapshot = false;
let selected = false;
const keys = new Set<string>();

function setSelection(value: boolean): void {
  selected = value;
  selectionRing.setEnabled(value);
  selection.textContent = value
    ? "Scout selected — ready for orders."
    : "Select the blue scout.";
}

function showState(state: WorldView): void {
  currentState = state;
  const scout = state.units.find((item) => item.id === "unit-1");
  if (!scout) return;
  targetPosition = new Vector3(scout.position.x, 0.6, scout.position.z);
  if (!hasSnapshot) {
    unit.position.copyFrom(targetPosition);
    hasSnapshot = true;
  }
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
    unitId: "unit-1",
    destination,
  };
  socket.send(JSON.stringify(command));
  status.textContent = "Move order sent. Waiting for server confirmation…";
}

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
scene.onPointerDown = (event, pick) => {
  if (event.button === 0) {
    setSelection(pick?.pickedMesh === unit);
  } else if (event.button === 2 && selected) {
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
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  );
  socket.onopen = () => {
    status.textContent = "Connected to the authoritative server.";
  };
  socket.onclose = () => {
    status.textContent = "Connection lost. Reconnecting…";
    window.setTimeout(connect, 2000);
  };
  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const message = serverMessageSchema.parse(
        JSON.parse(event.data) as unknown,
      );
      if (message.type === "SNAPSHOT") showState(message.state);
      else if (message.type === "ACK")
        status.textContent = "Move order accepted by the server.";
      else status.textContent = `Order rejected: ${message.message}`;
    } catch {
      status.textContent = "Received an invalid server message.";
    }
  };
}
connect();

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
  unit.position.copyFrom(
    Vector3.Lerp(unit.position, targetPosition, Math.min(1, delta * 12)),
  );
  if (selected)
    selectionRing.position.set(unit.position.x, 0.12, unit.position.z);
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
