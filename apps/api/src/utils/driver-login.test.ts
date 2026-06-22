import assert from "node:assert/strict";
import test from "node:test";
import { chooseDriverCompany } from "./driver-login.js";

const onlyDriver = [{
  driver: { id: "driver-1", company: { subdomain: "yasminlanches" } }
}];

test("aceita subdominio legado quando telefone e senha identificam um unico motoboy", () => {
  assert.deepEqual(chooseDriverCompany(onlyDriver, "deliverycoite"), onlyDriver);
});

test("prefere o subdominio exato quando o telefone existe em mais de uma empresa", () => {
  const drivers = [
    ...onlyDriver,
    { driver: { id: "driver-2", company: { subdomain: "pizzariadoze" } } }
  ];
  assert.deepEqual(
    chooseDriverCompany(drivers, "pizzariadoze"),
    [drivers[1]]
  );
});
