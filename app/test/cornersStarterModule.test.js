const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cornersPath = path.join(__dirname, "..", "src", "main", "starter_modules", "Corners.js");

const getStrokeOps = (operations, startIndex = 0) =>
  operations.slice(startIndex).filter((entry) => entry.type === "stroke");

const createContextSpy = () => {
  const operations = [];
  let currentPath = [];

  return {
    operations,
    clearRect: (...args) => {
      operations.push({ type: "clearRect", args });
    },
    beginPath: () => {
      currentPath = [];
    },
    moveTo: (x, y) => {
      currentPath.push({ type: "moveTo", x, y });
    },
    lineTo: (x, y) => {
      currentPath.push({ type: "lineTo", x, y });
    },
    stroke: () => {
      operations.push({ type: "stroke", path: currentPath.slice() });
    },
    set strokeStyle(value) {
      operations.push({ type: "strokeStyle", value });
    },
    set lineWidth(value) {
      operations.push({ type: "lineWidth", value });
    },
  };
};

const createContainer = (width = 200, height = 100) => {
  const children = [];
  return {
    offsetWidth: width,
    offsetHeight: height,
    style: {},
    children,
    appendChild(child) {
      child.parentNode = this;
      children.push(child);
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
    },
  };
};

const loadCornersModule = (documentStub) => {
  const source = fs
    .readFileSync(cornersPath, "utf8")
    .replace(/export default Corners;\s*$/, "module.exports = Corners;\n");

  const sandbox = {
    module: { exports: {} },
    exports: {},
    document: documentStub,
    ModuleBase: class ModuleBase {
      constructor(container) {
        this.elem = container;
        this.name = this.constructor.name;
      }

      destroy() {
        this.elem = null;
      }
    },
    console,
  };

  vm.runInNewContext(source, sandbox, { filename: cornersPath });
  return sandbox.module.exports;
};

test("Corners cornerVisibility is execute-on-load and persists across redraws", () => {
  const ctx = createContextSpy();
  const documentStub = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return {
        width: 0,
        height: 0,
        style: {},
        parentNode: null,
        getContext: () => ctx,
      };
    },
  };

  const Corners = loadCornersModule(documentStub);
  const visibilityMethod = Corners.methods.find((method) => method.name === "cornerVisibility");
  const normalizedOptions = JSON.parse(
    JSON.stringify(visibilityMethod.options.map((option) => [option.name, option.defaultVal]))
  );

  assert.ok(visibilityMethod);
  assert.equal(visibilityMethod.executeOnLoad, true);
  assert.deepEqual(normalizedOptions, [
    ["topLeft", true],
    ["topRight", true],
    ["bottomLeft", true],
    ["bottomRight", true],
  ]);

  const moduleInstance = new Corners(createContainer());
  assert.equal(getStrokeOps(ctx.operations).length, 4);

  let startIndex = ctx.operations.length;
  moduleInstance.cornerVisibility({
    topLeft: false,
    topRight: true,
    bottomLeft: false,
    bottomRight: true,
  });

  let strokes = getStrokeOps(ctx.operations, startIndex);
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every((stroke) => stroke.path[0]?.x > 100));

  startIndex = ctx.operations.length;
  moduleInstance.color({ color: "#ff0000" });
  strokes = getStrokeOps(ctx.operations, startIndex);
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every((stroke) => stroke.path[0]?.x > 100));

  startIndex = ctx.operations.length;
  moduleInstance.size({ size: 40 });
  strokes = getStrokeOps(ctx.operations, startIndex);
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every((stroke) => stroke.path[0]?.x > 100));

  startIndex = ctx.operations.length;
  moduleInstance.setCornerVisibility({
    topLeft: true,
    topRight: false,
    bottomLeft: false,
    bottomRight: false,
  });
  strokes = getStrokeOps(ctx.operations, startIndex);
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].path[0]?.x, 10);
});
