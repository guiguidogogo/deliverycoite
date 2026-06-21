export type RouteLocation = {
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export type RouteOrigin =
  | { latitude: number; longitude: number }
  | { address: string };

function locationValue(location: RouteLocation | RouteOrigin) {
  if (
    "latitude" in location
    && location.latitude !== null
    && location.longitude !== null
  ) {
    return `${location.latitude},${location.longitude}`;
  }
  return "address" in location ? location.address.trim() : "";
}

export function buildGoogleMapsDirectionsUrl(stops: RouteLocation[], origin: RouteOrigin) {
  if (!stops.length) throw new Error("A rota precisa ter pelo menos um destino");
  const originValue = locationValue(origin);
  if (!originValue) throw new Error("A origem da empresa nao foi configurada");

  const destination = locationValue(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(locationValue);
  const parameters = [
    "api=1",
    `origin=${encodeURIComponent(originValue)}`,
    `destination=${encodeURIComponent(destination)}`,
    ...(waypoints.length ? [`waypoints=${encodeURIComponent(waypoints.join("|"))}`] : []),
    "travelmode=driving",
    "dir_action=navigate"
  ];

  return `https://www.google.com/maps/dir/?${parameters.join("&")}`;
}

export function buildGoogleMapsNavigationUrl(stops: RouteLocation[]) {
  if (!stops.length) throw new Error("A rota precisa ter pelo menos um destino");
  const destination = locationValue(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(locationValue);
  const parameters = [
    "api=1",
    `destination=${encodeURIComponent(destination)}`,
    ...(waypoints.length ? [`waypoints=${encodeURIComponent(waypoints.join("|"))}`] : []),
    "travelmode=driving",
    "dir_action=navigate"
  ];
  return `https://www.google.com/maps/dir/?${parameters.join("&")}`;
}

export function buildGoogleMapsAndroidNavigationIntent(stops: RouteLocation[]) {
  if (!stops.length) throw new Error("A rota precisa ter pelo menos um destino");
  const destination = locationValue(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(locationValue);
  return [
    `google.navigation:q=${encodeURIComponent(destination)}`,
    ...(waypoints.length ? [`waypoints=${encodeURIComponent(waypoints.join("|"))}`] : []),
    "mode=d"
  ].join("&");
}
