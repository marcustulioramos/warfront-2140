import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from "@babylonjs/core";
import type { WorldView } from "@warfront/shared";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#battlefield");
const status = document.querySelector<HTMLElement>("#status");
if (!canvas || !status) throw new Error("Missing application elements");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor.set(0.04, 0.08, 0.12, 1);
const camera = new ArcRotateCamera(
  "camera",
  -Math.PI / 2,
  1.1,
  30,
  new Vector3(0, 0, 0),
  scene,
);
camera.attachControl(canvas, true);
new HemisphericLight("sun", new Vector3(1, 1, 0), scene);
const ground = MeshBuilder.CreateGround(
  "ground",
  { width: 40, height: 40 },
  scene,
);
const groundMaterial = new StandardMaterial("terrain", scene);
groundMaterial.diffuseColor = new Color3(0.13, 0.24, 0.19);
ground.material = groundMaterial;
const unit = MeshBuilder.CreateBox("unit", { size: 1.5 }, scene);
unit.position.y = 0.75;
const unitMaterial = new StandardMaterial("unit-blue", scene);
unitMaterial.diffuseColor = new Color3(0.1, 0.45, 0.9);
unit.material = unitMaterial;
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
const socket = new WebSocket(
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
);
socket.onopen = () => {
  status.textContent = "Server connected — development battlefield";
};
socket.onclose = () => {
  status.textContent = "Server disconnected";
};
socket.onmessage = (event: MessageEvent<string>) => {
  const message: unknown = JSON.parse(event.data);
  if (typeof message !== "object" || message === null || !("type" in message))
    return;
  if (message.type === "SNAPSHOT" && "state" in message) {
    const state = message.state as WorldView;
    const firstUnit = state.units[0];
    if (firstUnit)
      unit.position.set(firstUnit.position.x, 0.75, firstUnit.position.z);
  }
};
