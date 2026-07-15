import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAcliRunner } from "../../../src/acli.js";
import { fieldCommand } from "../../../src/commands/jira/field.js";
import { makeAcliFake } from "../../helpers/acliFake.js";
import { FROZEN_NOW, fieldCreatePayload } from "../../fixtures/acli.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  setAcliRunner(null);
  vi.useRealTimers();
});

const TEXTFIELD = "com.atlassian.jira.plugin.system.customfieldtypes:textfield";

describe("field create", () => {
  it("creates and renders the tolerant probe of acli's response", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "create", result: fieldCreatePayload },
    ]);
    setAcliRunner(runner);

    const out = await fieldCommand([
      "create",
      "--name",
      "Customer Name",
      "--type",
      TEXTFIELD,
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "field",
      "create",
      "--name",
      "Customer Name",
      "--type",
      TEXTFIELD,
      "--json",
    ]);
    expect(out).toContain("id: customfield_10500");
    expect(out).toContain("name: Customer Name");
    expect(out).toContain(`type: "${TEXTFIELD}"`);
    expect(out).toContain("message: Field created");
  });

  it("requires --name and --type", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      fieldCommand(["create", "--name", "Customer Name"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      fieldCommand(["create", "--type", TEXTFIELD]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("degrades to the message when acli's create shape drifts", async () => {
    const { runner } = makeAcliFake([
      { match: (args) => args[2] === "create", result: [] },
    ]);
    setAcliRunner(runner);

    const out = await fieldCommand([
      "create",
      "--name",
      "Customer Name",
      "--type",
      TEXTFIELD,
    ]);
    expect(out).toContain("message: Field created");
    expect(out).toContain("name: Customer Name");
  });
});

describe("field update", () => {
  it("updates by customfield id and renders the result", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "update", result: fieldCreatePayload },
    ]);
    setAcliRunner(runner);

    const out = await fieldCommand([
      "update",
      "customfield_10500",
      "--name",
      "Client Name",
    ]);
    expect(calls[0].args).toEqual([
      "jira",
      "field",
      "update",
      "--id",
      "customfield_10500",
      "--json",
      "--name",
      "Client Name",
    ]);
    expect(out).toContain("message: Field updated");
  });

  it("expands a bare numeric ID to customfield_<n> and rejects other shapes", async () => {
    const { runner, calls } = makeAcliFake([
      { match: (args) => args[2] === "update", result: {} },
    ]);
    setAcliRunner(runner);

    await fieldCommand(["update", "10500", "--name", "Client Name"]);
    expect(calls[0].args).toContain("customfield_10500");

    await expect(
      fieldCommand(["update", "summary", "--name", "x"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an empty update", async () => {
    setAcliRunner(makeAcliFake([]).runner);
    await expect(
      fieldCommand(["update", "customfield_10500"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("field delete / restore", () => {
  it("deletes without --json (acli has none) and suggests restore", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "delete",
        result: { stdout: "Field moved to trash\n", stderr: "", exitCode: 0 },
      },
    ]);
    setAcliRunner(runner);

    const out = await fieldCommand(["delete", "customfield_10500"]);
    expect(calls[0].args).toEqual([
      "jira",
      "field",
      "delete",
      "--id",
      "customfield_10500",
    ]);
    expect(out).toContain("message: Moved to trash");
    expect(out).toContain("field restore customfield_10500");
  });

  it("restores from trash", async () => {
    const { runner, calls } = makeAcliFake([
      {
        match: (args) => args[2] === "restore",
        result: { stdout: "Field restored\n", stderr: "", exitCode: 0 },
      },
    ]);
    setAcliRunner(runner);

    const out = await fieldCommand(["restore", "customfield_10500"]);
    expect(calls[0].args).toEqual([
      "jira",
      "field",
      "restore",
      "--id",
      "customfield_10500",
    ]);
    expect(out).toContain("message: Restored from trash");
  });

  it("returns help for --help and errors on unknown subcommands", async () => {
    expect(await fieldCommand(["--help"])).toContain("restore <ID>");
    const out = await fieldCommand(["list"]);
    expect(out).toContain("Unknown field subcommand: list");
    expect(out).toContain("field --help");
  });
});
