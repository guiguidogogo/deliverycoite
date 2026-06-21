import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleMapsAndroidNavigationIntent,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsNavigationUrl
} from "./google-maps-route.js";

test("gera rota com coordenadas, waypoints e navegacao", () => {
  const url = buildGoogleMapsDirectionsUrl([
    { address: "Primeiro", latitude: -11.1, longitude: -39.1 },
    { address: "Segundo", latitude: -11.2, longitude: -39.2 },
    { address: "Final", latitude: -11.3, longitude: -39.3 }
  ], { latitude: -11, longitude: -39 });

  assert.equal(
    url,
    "https://www.google.com/maps/dir/?api=1"
      + "&origin=-11%2C-39"
      + "&destination=-11.3%2C-39.3"
      + "&waypoints=-11.1%2C-39.1%7C-11.2%2C-39.2"
      + "&travelmode=driving"
      + "&dir_action=navigate"
  );
});

test("codifica enderecos textuais completos", () => {
  const url = buildGoogleMapsDirectionsUrl([
    { address: "Rua A, 10 - Centro, Conceicao do Coite - BA", latitude: null, longitude: null },
    { address: "Avenida Brasil, 25 - Centro", latitude: null, longitude: null }
  ], { address: "Praca da Matriz, 1 - Centro" });

  assert.match(url, /origin=Praca%20da%20Matriz%2C%201%20-%20Centro/);
  assert.match(url, /destination=Avenida%20Brasil%2C%2025%20-%20Centro/);
  assert.match(url, /waypoints=Rua%20A%2C%2010%20-%20Centro%2C%20Conceicao%20do%20Coite%20-%20BA/);
  assert.match(url, /dir_action=navigate$/);
});

test("gera link para iniciar pela localizacao atual sem origem fixa", () => {
  const stops = [
    { address: "Parada 1", latitude: -11.1, longitude: -39.1 },
    { address: "Destino", latitude: -11.2, longitude: -39.2 }
  ];
  const url = buildGoogleMapsNavigationUrl(stops);
  assert.doesNotMatch(url, /origin=/);
  assert.match(url, /destination=-11.2%2C-39.2/);
  assert.match(url, /waypoints=-11.1%2C-39.1/);
  assert.match(url, /dir_action=navigate$/);
});

test("gera intent nativo Android com todas as paradas", () => {
  const intent = buildGoogleMapsAndroidNavigationIntent([
    { address: "Rua A, 10", latitude: null, longitude: null },
    { address: "Rua B, 20", latitude: null, longitude: null }
  ]);
  assert.equal(
    intent,
    "google.navigation:q=Rua%20B%2C%2020&waypoints=Rua%20A%2C%2010&mode=d"
  );
});
